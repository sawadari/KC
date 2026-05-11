import fs from "node:fs";
import path from "node:path";
import { loadArtifacts, writeYamlFile } from "./artifacts.js";
import type { Finding } from "./types.js";

export interface IssueRecordOptions {
  workspace: string;
  issueRef: string;
  problem: string;
  expectedOutcome: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  riskTier: string;
  validationScenario?: string;
  validationStatus?: string;
  force?: boolean;
}

export function renderIssueBrief(input: string): string {
  const summary = input.trim() || "TBD";
  return [
    "# KC Issue Brief",
    "",
    "Use this brief to turn an intake note into `.kc/issue.yaml`.",
    "",
    "## Source",
    "",
    summary,
    "",
    "## Required Human Inputs",
    "",
    "1. Problem statement",
    "2. Expected outcome",
    "3. Acceptance criteria",
    "4. Non-goals",
    "5. Risk tier",
    "6. Validation scenario, or explicit validation_status=pending",
    "",
    "## Record Command",
    "",
    "```sh",
    "kc issue-record --issue-ref <github issue url> --problem <text> --expected-outcome <text> --acceptance-criterion <text> --non-goal <text> --risk-tier medium --validation-scenario <text>",
    "```"
  ].join("\n");
}

export function recordIssue(options: IssueRecordOptions): string {
  const workspace = path.resolve(options.workspace);
  const issuePath = path.join(workspace, ".kc", "issue.yaml");
  if (fs.existsSync(issuePath) && !options.force) {
    throw new Error(`${issuePath} already exists. Pass --force to overwrite.`);
  }

  const issuePacket: Record<string, unknown> = {
    issue_ref: options.issueRef,
    problem_statement: options.problem,
    expected_outcome: options.expectedOutcome,
    acceptance_criteria: options.acceptanceCriteria,
    risk_tier: options.riskTier,
    non_goals: options.nonGoals,
    issue_state: "ready_for_plan"
  };
  if (options.validationScenario) {
    issuePacket.validation_scenario = { statement: options.validationScenario };
  } else {
    issuePacket.validation_status = options.validationStatus || "pending";
  }

  writeYamlFile(issuePath, { issue_packet: issuePacket });
  return issuePath;
}

export function validateIssueArtifact(workspace: string): Finding[] {
  const issue = loadArtifacts(path.resolve(workspace)).issue;
  const findings: Finding[] = [];
  if (!issue) {
    findings.push(error("KC-ISSUE-001", "missing_issue", ".kc/issue.yaml is required."));
    return findings;
  }
  requireField(findings, issue, "problem_statement", "missing_problem_statement");
  requireField(findings, issue, "expected_outcome", "missing_expected_outcome");
  requireArray(findings, issue, "acceptance_criteria", "missing_acceptance_criteria");
  requireArray(findings, issue, "non_goals", "missing_non_goals");
  requireField(findings, issue, "risk_tier", "missing_risk_tier");
  if (!hasValue(issue.validation_scenario) && stringValue(issue.validation_status) !== "pending") {
    findings.push(error("KC-ISSUE-001", "missing_validation_scenario", "Issue requires validation_scenario or validation_status: pending."));
  }
  return findings;
}

function requireField(findings: Finding[], issue: Record<string, unknown>, key: string, reasonCode: string): void {
  if (!hasValue(issue[key])) {
    findings.push(error("KC-ISSUE-001", reasonCode, `${key} is required.`));
  }
}

function requireArray(findings: Finding[], issue: Record<string, unknown>, key: string, reasonCode: string): void {
  if (!Array.isArray(issue[key]) || (issue[key] as unknown[]).length === 0) {
    findings.push(error("KC-ISSUE-001", reasonCode, `${key} must contain at least one item.`));
  }
}

function error(ruleId: string, reasonCode: string, message: string): Finding {
  return { ruleId, severity: "error", reasonCode, message };
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
