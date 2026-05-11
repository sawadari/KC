import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { runAssist, systemPrompt } from "../lib/core/assist.js";
import { runCheck } from "../lib/core/check.js";
import { validatePullRequestBody } from "../lib/core/pr-body.js";
import { runPromote } from "../lib/core/promote.js";
import { initWorkspace } from "../lib/core/templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "tests", "fixtures");

describe("KC rule engine", () => {
  it("returns PASS for a fully evidenced approved change", async () => {
    const workspace = path.join(fixtures, "pass");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "PASS");
    assert.equal(result.mergeReady, true);
    assert.equal(result.primaryReason, "none");
  });

  it("returns WARN when validation scenario is explicitly pending", async () => {
    const workspace = path.join(fixtures, "warn");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "WARN");
    assert.equal(result.mergeReady, true);
    assert.equal(result.primaryReason, "validation_pending");
  });

  it("returns HOLD for out-of-scope or prohibited changes", async () => {
    const workspace = path.join(fixtures, "hold");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "HOLD");
    assert.equal(result.mergeReady, false);
    assert.equal(result.primaryReason, "scope_violation");
    assert.ok(result.findings.some((finding) => finding.reasonCode === "prohibited_file_changed"));
  });

  it("returns FAIL when validation is marked passed without validation evidence", async () => {
    const workspace = path.join(fixtures, "fail");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "FAIL");
    assert.equal(result.mergeReady, false);
    assert.equal(result.primaryReason, "validation_inferred_from_verification");
  });

  it("honors ruleset rule enablement", async () => {
    const workspace = path.join(fixtures, "ruleset-disabled");
    const result = await runCheck({
      workspace,
      rulesetPath: ".kc/ruleset.yaml",
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "PASS");
    assert.equal(result.findings.some((finding) => finding.ruleId === "KC-AE-007"), false);
  });

  it("honors ruleset severity overrides", async () => {
    const workspace = path.join(fixtures, "ruleset-override");
    const result = await runCheck({
      workspace,
      rulesetPath: ".kc/ruleset.yaml",
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "WARN");
    assert.equal(result.primaryReason, "missing_verification_evidence");
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-007" && finding.severity === "warning"));
  });

  it("fails deterministically for unknown ruleset rule ids", async () => {
    const workspace = path.join(fixtures, "ruleset-invalid");
    const result = await runCheck({
      workspace,
      rulesetPath: ".kc/ruleset.yaml",
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "FAIL");
    assert.equal(result.primaryReason, "unknown_rule_id");
  });
});

describe("KC CLI", () => {
  it("runs check successfully for PASS fixtures", () => {
    const workspace = path.join(fixtures, "pass");
    const result = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "check",
      "--workspace",
      workspace,
      "--changed-files",
      path.join(workspace, "changed-files.txt")
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /KC PR Check: PASS/);
  });

  it("exits non-zero for HOLD fixtures", () => {
    const workspace = path.join(fixtures, "hold");
    const result = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "check",
      "--workspace",
      workspace,
      "--changed-files",
      path.join(workspace, "changed-files.txt")
    ], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /KC PR Check: HOLD/);
  });
});

describe("workspace init and action build", () => {
  it("copies templates without overwriting existing files", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kc-init-"));
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "existing", "utf8");

    const result = initWorkspace({ workspace });

    assert.ok(result.skipped.includes("AGENTS.md"));
    assert.equal(fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf8"), "existing");
    assert.ok(fs.existsSync(path.join(workspace, ".kc", "plan.example.yaml")));
  });

  it("builds the GitHub Action bundle", () => {
    assert.ok(fs.existsSync(path.join(root, "dist", "action", "index.js")));
  });
});

describe("KC assist and promotion", () => {
  it("skips AI assist without an API key by default", async () => {
    const result = await runAssist({ kind: "issue-packet", input: "Need a retry policy." });

    assert.equal(result.skipped, true);
    assert.match(result.output, /OPENAI_API_KEY/);
  });

  it("emits parseable offline issue packet candidates", async () => {
    const result = await runAssist({ kind: "issue-packet", input: "Problem: retries are missing.", offlineTemplate: true });
    const parsed = YAML.parse(result.output);

    assert.equal(result.skipped, false);
    assert.equal(parsed.issue_packet.candidate_status, "draft");
    assert.equal(parsed.issue_packet.validation_status, "pending");
  });

  it("keeps prompt guardrails explicit", () => {
    const prompt = systemPrompt();

    assert.match(prompt, /Never claim approval/);
    assert.match(prompt, /validation passed/);
    assert.match(prompt, /candidate_status/);
  });

  it("writes canonical promotion candidates with source refs", () => {
    const workspace = createPromotionWorkspace();
    const result = runPromote({ workspace, outputDir: "promotion" });
    const ledger = fs.readFileSync(path.join(result.outputDir, "decision-ledger.candidate.md"), "utf8");

    assert.ok(result.files.length >= 5);
    assert.match(ledger, /candidate_status: draft/);
    assert.match(ledger, /issue_ref: github:org\/repo\/issues\/123/);
    assert.match(ledger, /plan_ref: PLAN-123/);
  });
});

describe("GitHub PR integration helpers", () => {
  it("detects missing required PR body sections", () => {
    const findings = validatePullRequestBody("## Linked Issue\n#1\n\n## Summary\nChange");

    assert.ok(findings.some((finding) => finding.reasonCode === "missing_pr_section" && finding.message.includes("Approved Plan")));
  });

  it("passes complete KC PR body sections", () => {
    const body = [
      "## Linked Issue",
      "#1",
      "## Approved Plan",
      "PLAN-1",
      "## Approval",
      "APR-1",
      "## Verification",
      "npm test passed",
      "## Validation",
      "VAL-1",
      "## KC Evidence",
      "AEB-1"
    ].join("\n");

    assert.deepEqual(validatePullRequestBody(body), []);
  });
});

describe("Codex hook templates", () => {
  it("blocks a simulated out-of-scope edit", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kc-hook-"));
    fs.mkdirSync(path.join(workspace, ".kc"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".kc", "approval.yaml"), [
      "plan_approval:",
      "  decision: approved",
      "  approved_scope:",
      "    - src/report/**"
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(workspace, ".kc", "plan.yaml"), [
      "agent_plan:",
      "  scope:",
      "    prohibited_files:",
      "      - src/auth/**"
    ].join("\n"), "utf8");

    const result = spawnSync(process.execPath, [
      path.join(root, "templates", "hooks", "kc-codex-hook.mjs"),
      "PreToolUse"
    ], {
      cwd: workspace,
      env: { ...process.env, KC_WORKSPACE: workspace },
      input: JSON.stringify({ tool_name: "apply_patch", tool_input: { path: "src/auth/session.ts" } }),
      encoding: "utf8"
    });

    assert.equal(result.status, 2);
    assert.match(result.stdout, /"decision": "block"/);
    assert.match(result.stdout, /prohibited_files/);
  });
});

function readChangedFiles(workspace) {
  return fs.readFileSync(path.join(workspace, "changed-files.txt"), "utf8").split(/\r?\n/).filter(Boolean);
}

function createPromotionWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kc-promote-"));
  fs.mkdirSync(path.join(workspace, ".kc"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".kc", "issue.yaml"), [
    "issue_packet:",
    "  issue_ref: github:org/repo/issues/123",
    "  expected_outcome: Add retry behavior."
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "plan.yaml"), [
    "agent_plan:",
    "  plan_id: PLAN-123",
    "  interpreted_requirement: Add retry behavior."
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "approval.yaml"), [
    "plan_approval:",
    "  approval_id: APR-123"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "evidence_bundle.yaml"), [
    "approval_evidence_bundle:",
    "  bundle_id: AEB-123",
    "  pr_ref: github:org/repo/pull/456",
    "  validation_evidence:",
    "    - type: validation_report",
    "      ref: reports/validation/VAL-123.md",
    "      status: passed"
  ].join("\n"), "utf8");
  return workspace;
}
