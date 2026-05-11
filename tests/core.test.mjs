import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderApprovalBrief, recordApprovalChoice } from "../lib/core/approval-brief.js";
import { runAssist, systemPrompt, validateStructuredOutput } from "../lib/core/assist.js";
import { runCheck } from "../lib/core/check.js";
import { recordIssue, renderIssueBrief, validateIssueArtifact } from "../lib/core/issue.js";
import { closeWork, finalizeWork } from "../lib/core/lifecycle.js";
import { shouldValidatePullRequestBody, validatePullRequestBody } from "../lib/core/pr-body.js";
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

  it("holds approved plans that lack human approval evidence", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: false });

    const result = await runCheck({
      workspace,
      changedFiles: ["src/report/upload.ts"]
    });

    assert.equal(result.decision, "HOLD");
    assert.equal(result.primaryReason, "missing_human_approval_evidence");
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-013"));
  });

  it("holds active artifacts that still contain placeholders", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    fs.writeFileSync(path.join(workspace, ".kc", "plan.yaml"), YAML.stringify({
      agent_plan: {
        plan_id: "PLAN-123",
        issue_ref: "github:org/repo/issues/123",
        interpreted_requirement: "TBD",
        scope: { allowed_files: ["src/report/upload.ts"] },
        status: "approved"
      }
    }), "utf8");

    const result = await runCheck({
      workspace,
      changedFiles: ["src/report/upload.ts"]
    });

    assert.equal(result.decision, "HOLD");
    assert.equal(result.primaryReason, "placeholder_detected");
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-014"));
  });

  it("blocks high-risk validation pending without an exception basis", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    const issuePath = path.join(workspace, ".kc", "issue.yaml");
    const issue = YAML.parse(fs.readFileSync(issuePath, "utf8"));
    delete issue.issue_packet.validation_scenario;
    issue.issue_packet.validation_status = "pending";
    issue.issue_packet.risk_tier = "high";
    fs.writeFileSync(issuePath, YAML.stringify(issue), "utf8");

    const result = await runCheck({
      workspace,
      changedFiles: ["src/report/upload.ts"]
    });

    assert.equal(result.decision, "HOLD");
    assert.equal(result.primaryReason, "high_risk_validation_pending");
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-015"));
  });

  it("allows high-risk validation pending with an exception basis", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    const issuePath = path.join(workspace, ".kc", "issue.yaml");
    const issue = YAML.parse(fs.readFileSync(issuePath, "utf8"));
    delete issue.issue_packet.validation_scenario;
    issue.issue_packet.validation_status = "pending";
    issue.issue_packet.risk_tier = "high";
    issue.issue_packet.exception_basis = "Owner accepted deferred validation.";
    fs.writeFileSync(issuePath, YAML.stringify(issue), "utf8");
    const evidencePath = path.join(workspace, ".kc", "evidence_bundle.yaml");
    const evidence = YAML.parse(fs.readFileSync(evidencePath, "utf8"));
    evidence.approval_evidence_bundle.rollback_path = "Revert the upload retry change.";
    fs.writeFileSync(evidencePath, YAML.stringify(evidence), "utf8");

    const result = await runCheck({
      workspace,
      changedFiles: ["src/report/upload.ts"]
    });

    assert.equal(result.decision, "WARN");
    assert.equal(result.primaryReason, "validation_pending");
  });

  it("flags changed files that are not mapped to plan item expected files", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    const planPath = path.join(workspace, ".kc", "plan.yaml");
    const plan = YAML.parse(fs.readFileSync(planPath, "utf8"));
    plan.agent_plan.plan_items = [{ id: "P1", action: "Update upload", expected_files: ["src/report/upload.ts"] }];
    fs.writeFileSync(planPath, YAML.stringify(plan), "utf8");

    const result = await runCheck({
      workspace,
      changedFiles: ["src/report/upload.ts", "src/report/extra.ts"]
    });

    assert.equal(result.decision, "HOLD");
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-016" && finding.reasonCode === "unmapped_plan_item_change"));
  });

  it("detects stale completed lifecycle state in current mode", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    fs.writeFileSync(path.join(workspace, ".kc", "current.yaml"), YAML.stringify({
      kc_current: {
        lifecycle_state: "finalized",
        active_work: false,
        work_id: "KC-FIXTURE-789",
        final_status: "completed"
      }
    }), "utf8");
    const issuePath = path.join(workspace, ".kc", "issue.yaml");
    const issue = YAML.parse(fs.readFileSync(issuePath, "utf8"));
    issue.issue_packet.issue_state = "ready_for_plan";
    fs.writeFileSync(issuePath, YAML.stringify(issue), "utf8");
    const evidencePath = path.join(workspace, ".kc", "evidence_bundle.yaml");
    const evidence = YAML.parse(fs.readFileSync(evidencePath, "utf8"));
    evidence.approval_evidence_bundle.pr_ref = "pending";
    evidence.approval_evidence_bundle.final_status = "completed";
    evidence.approval_evidence_bundle.decision = { required_actions: ["Publish npm."] };
    fs.writeFileSync(evidencePath, YAML.stringify(evidence), "utf8");

    const result = await runCheck({
      workspace,
      mode: "current",
      changedFiles: []
    });

    assert.equal(result.decision, "HOLD");
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-017" && finding.reasonCode === "lifecycle_state_stale"));
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-018"));
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-019"));
    assert.ok(result.findings.some((finding) => finding.ruleId === "KC-AE-020"));
  });

  it("passes current mode after finalizing completed work", async () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    const evidencePath = path.join(workspace, ".kc", "evidence_bundle.yaml");
    const evidence = YAML.parse(fs.readFileSync(evidencePath, "utf8"));
    evidence.approval_evidence_bundle.pr_ref = "pending";
    evidence.approval_evidence_bundle.decision = { required_actions: ["Merge PR."] };
    fs.writeFileSync(evidencePath, YAML.stringify(evidence), "utf8");

    const finalizeResult = finalizeWork({
      workspace,
      issueRef: "github:sawadari/KC-fixture/issues/789",
      prRef: "github:sawadari/KC-fixture/pull/456",
      releaseRef: "https://github.com/sawadari/KC-fixture/releases/tag/v9.9.9",
      npmRef: "@sawadari/kc@9.9.9",
      workId: "KC-FIXTURE-789",
      status: "completed"
    });

    assert.ok(fs.existsSync(finalizeResult.currentPath));
    assert.ok(fs.existsSync(finalizeResult.archivePath));
    const current = YAML.parse(fs.readFileSync(finalizeResult.currentPath, "utf8"));
    assert.equal(current.kc_current.active_work, false);
    assert.equal(current.kc_current.lifecycle_state, "finalized");
    assert.equal(current.kc_current.final_evidence_bundle_ref, ".kc/archive/KC-FIXTURE-789.final.yaml");

    const result = await runCheck({
      workspace,
      mode: "current",
      changedFiles: []
    });

    assert.equal(result.decision, "PASS");
    assert.deepEqual(result.findings.filter((finding) => finding.ruleId.startsWith("KC-AE-017") || finding.ruleId.startsWith("KC-AE-018")), []);
  });
});

describe("KC CLI", () => {
  it("prints root help for --help", () => {
    const result = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "--help"
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /kc check/);
  });

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

  it("runs finalize and close-work from the CLI", () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    const finalize = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "finalize",
      "--workspace",
      workspace,
      "--issue-ref",
      "github:sawadari/KC-fixture/issues/789",
      "--pr-ref",
      "github:sawadari/KC-fixture/pull/456",
      "--status",
      "completed",
      "--work-id",
      "KC-FIXTURE-789"
    ], { encoding: "utf8" });

    assert.equal(finalize.status, 0, finalize.stderr);
    assert.match(finalize.stdout, /KC work finalized/);

    const close = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "close-work",
      "--workspace",
      workspace,
      "--archive",
      "--force"
    ], { encoding: "utf8" });

    assert.equal(close.status, 0, close.stderr);
    assert.match(close.stdout, /archived .kc\/archive\/KC-FIXTURE-789\/issue.yaml/);
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
    assert.ok(fs.statSync(path.join(root, "dist", "action", "index.js")).size > 0);
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
    assert.match(ledger, /issue_ref: github:sawadari\/KC-fixture\/issues\/123/);
    assert.match(ledger, /plan_ref: PLAN-KC-FIXTURE-123/);
    assert.match(ledger, /human_decision_context:/);
  });

  it("rejects AI assist outputs that claim authority", () => {
    assert.throws(() => validateStructuredOutput("plan", YAML.stringify({
      agent_plan: {
        candidate_status: "draft",
        decision: "approved"
      }
    })), /attempted to claim/);
    assert.throws(() => validateStructuredOutput("evidence-bundle", YAML.stringify({
      approval_evidence_bundle: {
        candidate_status: "draft",
        validation_status: "passed"
      }
    })), /attempted to claim/);
    assert.throws(() => validateStructuredOutput("evidence-bundle", YAML.stringify({
      approval_evidence_bundle: {
        candidate_status: "draft",
        decision: {
          branch: "execute",
          merge_ready: true
        }
      }
    })), /attempted to claim/);
  });
});

describe("KC approval brief", () => {
  it("renders numbered approval choices", () => {
    const workspace = createHumanApprovalWorkspace({ withHumanApproval: true });
    const brief = renderApprovalBrief({ workspace });

    assert.match(brief, /KC Approval Brief/);
    assert.match(brief, /1\. Approve/);
    assert.match(brief, /2\. Approve with conditions/);
    assert.match(brief, /3\. Request changes/);
    assert.match(brief, /4\. Reject/);
  });

  it("records a numbered approval choice with durable human evidence", () => {
    const workspace = createPromotionWorkspace();
    const result = recordApprovalChoice({
      workspace,
      choice: "1",
      actor: "sawadari",
      source: "github_issue_comment",
      ref: "https://github.com/sawadari/KC-fixture/issues/123#issuecomment-123456",
      summary: "Approved by numbered brief."
    });
    const approval = YAML.parse(fs.readFileSync(path.join(workspace, ".kc", "approval.yaml"), "utf8"));

    assert.equal(result.decision, "approved");
    assert.equal(approval.plan_approval.decision, "approved");
    assert.equal(approval.plan_approval.human_approval.actor, "sawadari");
    assert.equal(approval.plan_approval.human_approval.choice, "1");
    assert.equal(approval.plan_approval.human_approval.ref, "https://github.com/sawadari/KC-fixture/issues/123#issuecomment-123456");
  });
});

describe("KC issue intake", () => {
  it("renders issue briefs and records issue artifacts", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kc-issue-"));
    const brief = renderIssueBrief("Need scoped approval evidence.");
    assert.match(brief, /KC Issue Brief/);

    const issuePath = recordIssue({
      workspace,
      issueRef: "github:sawadari/KC/issues/24",
      problem: "Issue intake is not explicit.",
      expectedOutcome: "Users can record issue artifacts from the CLI.",
      acceptanceCriteria: ["Record .kc/issue.yaml"],
      nonGoals: ["AI approval"],
      riskTier: "medium",
      validationScenario: "Run issue-check."
    });

    assert.ok(fs.existsSync(issuePath));
    assert.deepEqual(validateIssueArtifact(workspace), []);
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

  it("supports opt-in PR body enforcement", () => {
    const config = {
      kc: {
        enforcement: {
          mode: "opt_in",
          require_when: {
            labels: ["codex"],
            changed_paths: ["src/**"],
            pr_body_marker: "KC: required"
          }
        }
      }
    };

    assert.equal(shouldValidatePullRequestBody({ body: "Update docs", labels: ["docs"], changedFiles: ["README.md"], config }), false);
    assert.equal(shouldValidatePullRequestBody({ body: "Update\n\nKC: required", labels: [], changedFiles: [], config }), true);
    assert.equal(shouldValidatePullRequestBody({ body: "Update", labels: ["codex"], changedFiles: [], config }), true);
    assert.equal(shouldValidatePullRequestBody({ body: "Update", labels: [], changedFiles: ["src/index.ts"], config }), true);
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
    "  issue_ref: github:sawadari/KC-fixture/issues/123",
    "  expected_outcome: Add retry behavior."
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "plan.yaml"), [
    "agent_plan:",
    "  plan_id: PLAN-KC-FIXTURE-123",
    "  interpreted_requirement: Add retry behavior."
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "approval.yaml"), [
    "plan_approval:",
    "  approval_id: APR-KC-FIXTURE-123",
    "  conditions:",
    "    - id: COND-KC-FIXTURE-1",
    "      statement: Keep validation evidence explicit.",
    "      evidence_required: validation_report",
    "  human_approval:",
    "    actor: sawadari",
    "    source: github_issue_comment",
    "    ref: https://github.com/sawadari/KC-fixture/issues/123#issuecomment-123456"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "evidence_bundle.yaml"), [
    "approval_evidence_bundle:",
    "  bundle_id: AEB-KC-FIXTURE-123",
    "  pr_ref: github:sawadari/KC-fixture/pull/456",
    "  plan_diff_trace:",
    "    - plan_item_id: P1",
    "      expected_files:",
    "        - src/retry.ts",
    "      actual_files:",
    "        - src/retry.ts",
    "      status: implemented",
    "  validation_evidence:",
    "    - type: validation_report",
    "      ref: reports/validation/VAL-123.md",
    "      status: passed"
  ].join("\n"), "utf8");
  return workspace;
}

function createHumanApprovalWorkspace({ withHumanApproval }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kc-human-approval-"));
  fs.mkdirSync(path.join(workspace, ".kc"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".kc", "issue.yaml"), YAML.stringify({
    issue_packet: {
      issue_ref: "github:sawadari/KC-fixture/issues/789",
      problem_statement: "Need upload retry behavior.",
      expected_outcome: "Transient upload failures are retried.",
      acceptance_criteria: ["Retry transient upload failures."],
      validation_scenario: { statement: "Transient failure recovers." },
      risk_tier: "medium",
      non_goals: ["Authentication changes"]
    }
  }), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "plan.yaml"), YAML.stringify({
    agent_plan: {
      plan_id: "PLAN-KC-FIXTURE-789",
      issue_ref: "github:sawadari/KC-fixture/issues/789",
      interpreted_requirement: "Add upload retry behavior.",
      scope: {
        allowed_files: ["src/report/upload.ts"],
        prohibited_files: ["src/auth/**"]
      },
      status: "approved"
    }
  }), "utf8");
  const approval = {
    approval_id: "APR-KC-FIXTURE-789",
    target_plan_id: "PLAN-KC-FIXTURE-789",
    decision: "approved",
    approved_scope: ["src/report/upload.ts"],
    conditions: []
  };
  if (withHumanApproval) {
    approval.human_approval = {
      actor: "sawadari",
      source: "github_issue_comment",
      ref: "https://github.com/sawadari/KC-fixture/issues/789#issuecomment-123456",
      summary: "Approved fixture plan."
    };
  }
  fs.writeFileSync(path.join(workspace, ".kc", "approval.yaml"), YAML.stringify({ plan_approval: approval }), "utf8");
  fs.writeFileSync(path.join(workspace, ".kc", "evidence_bundle.yaml"), YAML.stringify({
    approval_evidence_bundle: {
      bundle_id: "AEB-KC-FIXTURE-789",
      issue_ref: "github:sawadari/KC-fixture/issues/789",
      plan_ref: "PLAN-KC-FIXTURE-789",
      approval_ref: "APR-KC-FIXTURE-789",
      diff_summary: { changed_files: ["src/report/upload.ts"], out_of_scope_files: [] },
      verification_evidence: [{ type: "unit_test", ref: "npm test", status: "passed" }],
      validation_evidence: [{ type: "validation_report", ref: "reports/validation/VAL-789.md", status: "passed" }]
    }
  }), "utf8");
  return workspace;
}
