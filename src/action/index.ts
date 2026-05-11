import fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { DefaultArtifactClient } from "@actions/artifact";
import { runAssist, defaultModel } from "../core/assist.js";
import { runCheck } from "../core/check.js";

async function main(): Promise<void> {
  const workspace = core.getInput("workspace") || ".";
  const ruleset = core.getInput("ruleset") || ".kc/ruleset.yaml";
  const aiAssist = core.getBooleanInput("ai-assist");
  const model = core.getInput("model") || defaultModel;
  const commentOnPr = core.getBooleanInput("comment-on-pr");
  const prRef = github.context.payload.pull_request?.html_url;

  const result = await runCheck({ workspace, rulesetPath: ruleset, prRef });

  core.setOutput("decision", result.decision);
  core.setOutput("merge_ready", String(result.mergeReady));
  core.setOutput("primary_reason", result.primaryReason);
  core.setOutput("findings_json", JSON.stringify(result.findings));
  core.setOutput("evidence_bundle_path", result.evidenceBundlePath);

  for (const finding of result.findings) {
    const message = `${finding.ruleId} ${finding.reasonCode}: ${finding.message}`;
    if (finding.severity === "error") {
      core.error(message);
    } else if (finding.severity === "warning") {
      core.warning(message);
    } else {
      core.info(message);
    }
  }

  await uploadBundle(result.evidenceBundlePath);

  let aiCandidate = "";
  if (aiAssist) {
    const apiKey = core.getInput("openai-api-key") || process.env.OPENAI_API_KEY;
    const assist = await runAssist({
      apiKey,
      model,
      kind: "pr-summary",
      input: JSON.stringify({
        decision: result.decision,
        mergeReady: result.mergeReady,
        primaryReason: result.primaryReason,
        findings: result.findings
      }, null, 2)
    });
    aiCandidate = assist.output;
    core.notice("AI assist generated candidate explanatory text. Deterministic decision is unchanged.");
  }

  await writeSummary(result, aiCandidate);
  if (commentOnPr) {
    await comment(result, aiCandidate);
  }

  if (result.decision === "HOLD" || result.decision === "FAIL") {
    core.setFailed(`KC Guard ${result.decision}: ${result.primaryReason}`);
  }
}

async function uploadBundle(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const artifactClient = new DefaultArtifactClient();
  await artifactClient.uploadArtifact("kc-evidence-bundle", [filePath], process.cwd());
}

async function writeSummary(result: Awaited<ReturnType<typeof runCheck>>, aiCandidate: string): Promise<void> {
  await core.summary
    .addHeading(`KC Guard: ${result.decision}`)
    .addRaw(`merge_ready: ${result.mergeReady}\n\n`)
    .addRaw(`primary_reason: ${result.primaryReason}\n\n`)
    .addTable([
      [
        { data: "Rule", header: true },
        { data: "Severity", header: true },
        { data: "Reason", header: true },
        { data: "Message", header: true }
      ],
      ...result.findings.map((finding) => [finding.ruleId, finding.severity, finding.reasonCode, finding.message])
    ])
    .addRaw(aiCandidate ? `\n\n### AI Candidate\n\n${aiCandidate}\n` : "")
    .write();
}

async function comment(result: Awaited<ReturnType<typeof runCheck>>, aiCandidate: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const pullRequest = github.context.payload.pull_request;
  if (!token || !pullRequest) {
    return;
  }

  const octokit = github.getOctokit(token);
  const body = [
    `## KC Guard: ${result.decision}`,
    "",
    `- merge_ready: ${result.mergeReady}`,
    `- primary_reason: ${result.primaryReason}`,
    `- evidence_bundle: \`${result.evidenceBundlePath}\``,
    "",
    "### Findings",
    ...result.findings.map((finding) => `- [${finding.severity}] ${finding.ruleId} ${finding.reasonCode}: ${finding.message}`),
    aiCandidate ? `\n### AI Candidate\n\n${aiCandidate}` : ""
  ].join("\n");

  await octokit.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: pullRequest.number,
    body
  });
}

main().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});

