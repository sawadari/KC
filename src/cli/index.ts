#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { renderApprovalBrief, recordApprovalChoice } from "../core/approval-brief.js";
import { normalizeAssistKind, runAssist, defaultModel } from "../core/assist.js";
import { runCheck } from "../core/check.js";
import { recordIssue, renderIssueBrief, validateIssueArtifact } from "../core/issue.js";
import { closeWork, finalizeWork } from "../core/lifecycle.js";
import { runPromote } from "../core/promote.js";
import { initWorkspace } from "../core/templates.js";

interface ParsedArgs {
  command: string;
  values: Map<string, string[]>;
  positionals: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "help" || args.command === "--help" || args.command === "-h" || args.values.has("help")) {
    printHelp();
    return;
  }

  if (args.command === "init") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const result = initWorkspace({ workspace, force: args.values.has("force") });
    console.log(`KC init complete: ${result.created.length} created, ${result.skipped.length} skipped.`);
    for (const file of result.created) {
      console.log(`created ${file}`);
    }
    for (const file of result.skipped) {
      console.log(`skipped ${file}`);
    }
    return;
  }

  if (args.command === "check" || args.command === "bundle") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const changedFiles = await readChangedFiles(args);
    const result = await runCheck({
      workspace,
      rulesetPath: value(args, "ruleset") || ".kc/ruleset.yaml",
      changedFiles,
      prRef: value(args, "pr-ref"),
      mode: checkMode(value(args, "mode"))
    });
    printCheckResult(result, args.values.has("json"));
    if (args.command === "check" && (result.decision === "HOLD" || result.decision === "FAIL")) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.command === "assist") {
    const input = await readAssistInput(args);
    const result = await runAssist({
      apiKey: value(args, "openai-api-key") || process.env.OPENAI_API_KEY,
      model: value(args, "model") || defaultModel,
      kind: normalizeAssistKind(value(args, "kind") || "issue-packet"),
      input,
      offlineTemplate: args.values.has("offline-template")
    });
    await writeOrPrint(args, `# KC AI Assist Candidate${result.model ? ` (${result.model})` : ""}\n\n${result.output}`);
    return;
  }

  if (args.command === "approval-brief") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    console.log(renderApprovalBrief({ workspace }));
    return;
  }

  if (args.command === "issue-brief") {
    const input = await readAssistInput(args);
    await writeOrPrint(args, renderIssueBrief(input));
    return;
  }

  if (args.command === "issue-record") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const issuePath = recordIssue({
      workspace,
      issueRef: requiredValue(args, "issue-ref"),
      problem: requiredValue(args, "problem"),
      expectedOutcome: requiredValue(args, "expected-outcome"),
      acceptanceCriteria: args.values.get("acceptance-criterion") ?? [requiredValue(args, "acceptance-criteria")],
      nonGoals: args.values.get("non-goal") ?? [requiredValue(args, "non-goals")],
      riskTier: value(args, "risk-tier") || "medium",
      validationScenario: value(args, "validation-scenario"),
      validationStatus: value(args, "validation-status"),
      force: args.values.has("force")
    });
    console.log(`KC issue recorded: ${issuePath}`);
    return;
  }

  if (args.command === "issue-check") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const findings = validateIssueArtifact(workspace);
    console.log(`KC issue check: ${findings.length === 0 ? "PASS" : "HOLD"}`);
    for (const finding of findings) {
      console.log(`- [${finding.severity}] ${finding.ruleId} ${finding.reasonCode}: ${finding.message}`);
    }
    if (findings.some((finding) => finding.severity === "error")) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.command === "approval-record") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const result = recordApprovalChoice({
      workspace,
      choice: requiredValue(args, "choice"),
      actor: requiredValue(args, "actor"),
      source: requiredValue(args, "source"),
      ref: requiredValue(args, "ref"),
      summary: value(args, "summary")
    });
    console.log(`KC approval recorded: ${result.decision}`);
    console.log(`choice: ${result.choice.number} (${result.choice.label})`);
    console.log(`approval: ${result.approvalPath}`);
    return;
  }

  if (args.command === "promote") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const result = runPromote({
      workspace,
      outputDir: value(args, "output-dir")
    });
    console.log(`KC promotion candidates written to ${result.outputDir}`);
    for (const file of result.files) {
      console.log(`created ${file}`);
    }
    return;
  }

  if (args.command === "finalize") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const result = finalizeWork({
      workspace,
      issueRef: value(args, "issue-ref"),
      prRef: value(args, "pr-ref"),
      releaseRef: value(args, "release-ref"),
      npmRef: value(args, "npm-ref"),
      status: value(args, "status") || "completed",
      workId: value(args, "work-id"),
      finalEvidenceBundleRef: value(args, "final-evidence-bundle-ref"),
      verifyExternal: args.values.has("verify-external"),
      expectedCommit: value(args, "expected-commit"),
      tagRefs: args.values.get("tag-ref"),
      force: args.values.has("force")
    });
    console.log(`KC work finalized: ${result.currentPath}`);
    if (result.archivePath) {
      console.log(`archive: ${result.archivePath}`);
    }
    return;
  }

  if (args.command === "close-work") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const result = closeWork({
      workspace,
      workId: value(args, "work-id"),
      archive: args.values.has("archive") || !args.values.has("no-archive"),
      force: args.values.has("force")
    });
    console.log(`KC work closed: ${result.currentPath}`);
    for (const file of result.archivedFiles ?? []) {
      console.log(`archived ${file}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const values = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const [key, inlineValue] = withoutPrefix.split("=", 2);
    if (inlineValue !== undefined) {
      push(values, key, inlineValue);
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      push(values, key, next);
      index += 1;
    } else {
      push(values, key, "true");
    }
  }

  return { command, values, positionals };
}

function push(values: Map<string, string[]>, key: string, item: string): void {
  const current = values.get(key) ?? [];
  current.push(item);
  values.set(key, current);
}

function value(args: ParsedArgs, key: string): string | undefined {
  return args.values.get(key)?.at(-1);
}

function requiredValue(args: ParsedArgs, key: string): string {
  const result = value(args, key);
  if (!result) {
    throw new Error(`--${key} is required.`);
  }
  return result;
}

function checkMode(raw: string | undefined): "pr" | "current" {
  if (!raw || raw === "pr") {
    return "pr";
  }
  if (raw === "current") {
    return "current";
  }
  throw new Error(`Unsupported --mode: ${raw}. Expected pr or current.`);
}

async function readChangedFiles(args: ParsedArgs): Promise<string[] | undefined> {
  const inline = args.values.get("changed-file") ?? [];
  const filePath = value(args, "changed-files");
  if (!filePath) {
    return inline.length > 0 ? inline : undefined;
  }
  const content = fs.readFileSync(path.resolve(filePath), "utf8");
  return [...inline, ...content.split(/\r?\n/).filter(Boolean)];
}

async function readAssistInput(args: ParsedArgs): Promise<string> {
  const inputFile = value(args, "input");
  if (inputFile) {
    return fs.readFileSync(path.resolve(inputFile), "utf8");
  }
  if (args.positionals.length > 0) {
    return args.positionals.join(" ");
  }
  return await readStdin();
}

async function writeOrPrint(args: ParsedArgs, content: string): Promise<void> {
  const outputFile = value(args, "output");
  if (!outputFile) {
    console.log(content);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outputFile), content, "utf8");
  console.log(`written ${outputFile}`);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printCheckResult(result: Awaited<ReturnType<typeof runCheck>>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`KC PR Check: ${result.decision}`);
  console.log(`merge_ready: ${result.mergeReady}`);
  console.log(`primary_reason: ${result.primaryReason}`);
  console.log(`evidence_bundle: ${result.evidenceBundlePath}`);
  if (result.changedFiles.length > 0) {
    console.log("");
    console.log("Changed files:");
    for (const file of result.changedFiles) {
      console.log(`- ${file}`);
    }
  }
  if (result.findings.length > 0) {
    console.log("");
    console.log("Findings:");
    for (const finding of result.findings) {
      const location = finding.path ? ` (${finding.path})` : "";
      console.log(`- [${finding.severity}] ${finding.ruleId} ${finding.reasonCode}${location}: ${finding.message}`);
    }
  }
}

function printHelp(): void {
  console.log(`kc - Knowledge Convergence guard for Codex + GitHub

Usage:
  kc init [--workspace .] [--force]
  kc check [--workspace .] [--mode pr|current] [--changed-files files.txt] [--changed-file path] [--json]
  kc bundle [--workspace .] [--changed-files files.txt]
  kc assist [--kind issue-packet|plan|evidence-bundle|decision-ledger|pr-summary] [--input file] [--model gpt-5.5] [--offline-template] [--output file]
  kc issue-brief [--input file] [--output file]
  kc issue-record --issue-ref URL --problem text --expected-outcome text --acceptance-criterion text --non-goal text [--risk-tier medium] [--validation-scenario text]
  kc issue-check [--workspace .]
  kc approval-brief [--workspace .]
  kc approval-record --choice 1 --actor sawadari --source github_issue_comment --ref URL [--summary text]
  kc finalize --workspace . --issue-ref URL --pr-ref URL --release-ref URL --npm-ref @scope/name@version [--verify-external]
  kc close-work --workspace . [--archive]
  kc promote [--workspace .] [--output-dir reports/promotion]

AI assist uses OPENAI_API_KEY or --openai-api-key. Deterministic checks do not require API credentials.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
