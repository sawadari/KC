import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  nrvv?: Record<string, unknown>;
  force?: boolean;
}

export interface IssueSyncOptions {
  workspace: string;
  issueRef: string;
  force?: boolean;
}

export interface IssueSyncSource {
  issueRef: string;
  title?: string;
  body: string;
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
    "### Need",
    "1. Who has the need?",
    "2. What situation creates the problem?",
    "3. What pain, risk, delay, cost, or failure is caused?",
    "4. What operational outcome should improve?",
    "",
    "### Requirement",
    "5. What must the system or software satisfy?",
    "6. Which requirements are constraints or non-goals?",
    "",
    "### Verification",
    "7. How will each requirement be checked?",
    "8. Which evidence should be attached?",
    "",
    "### Validation",
    "9. What scenario proves that the original need is satisfied?",
    "10. What success criteria distinguish validation from passing tests?",
    "11. What environment is required for validation?",
    "",
    "## Record Command",
    "",
    "```sh",
    "kc issue-record --issue-ref <github issue url> --problem <text> --expected-outcome <text> --acceptance-criterion <text> --non-goal <text> --risk-tier medium --validation-scenario <text> --nrvv-file .kc/nrvv.yaml",
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
  if (options.nrvv && hasValue(options.nrvv)) {
    issuePacket.nrvv = options.nrvv;
  }

  writeYamlFile(issuePath, { issue_packet: issuePacket });
  return issuePath;
}

export function syncIssueFromGitHub(options: IssueSyncOptions): string {
  const raw = execFileSync("gh", ["issue", "view", options.issueRef, "--json", "body,title,url"], {
    cwd: path.resolve(options.workspace),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const parsed = JSON.parse(raw) as { body?: string; title?: string; url?: string };
  const issue = issueFromMarkdown({
    issueRef: parsed.url || options.issueRef,
    title: parsed.title,
    body: parsed.body ?? ""
  });
  return recordIssue({
    workspace: options.workspace,
    issueRef: issue.issueRef,
    problem: issue.problem,
    expectedOutcome: issue.expectedOutcome,
    acceptanceCriteria: issue.acceptanceCriteria,
    nonGoals: issue.nonGoals,
    riskTier: issue.riskTier,
    validationScenario: issue.validationScenario,
    validationStatus: issue.validationScenario ? undefined : "pending",
    nrvv: issue.nrvv,
    force: options.force
  });
}

export function issueFromMarkdown(source: IssueSyncSource): Omit<IssueRecordOptions, "workspace" | "force"> {
  const sections = markdownSections(source.body);
  const problem = pickText(sections, ["problem", "problem statement", "summary"]) || source.title || firstParagraph(source.body) || "Unspecified issue problem.";
  const expectedOutcome = pickText(sections, ["expected outcome", "outcome", "goal"]) || source.title || problem;
  const acceptanceCriteria = pickList(sections, ["acceptance criteria", "acceptance", "criteria"]);
  const nonGoals = pickList(sections, ["non-goals", "non goals", "out of scope"]);
  const riskTier = normalizeRiskTier(pickText(sections, ["risk tier", "risk"]) || "medium");
  const validationScenario = pickText(sections, ["validation scenario", "validation"]);
  const nrvv = parseNrvv(sections);
  return {
    issueRef: source.issueRef,
    problem,
    expectedOutcome,
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : ["Review the synced GitHub Issue and define acceptance criteria."],
    nonGoals: nonGoals.length > 0 ? nonGoals : ["Review the synced GitHub Issue and define non-goals."],
    riskTier,
    validationScenario,
    nrvv
  };
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

function markdownSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = "body";
  let buffer: string[] = [];
  const flush = (): void => {
    const text = buffer.join("\n").trim();
    if (text) {
      sections.set(current, text);
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      current = normalizeHeading(heading[1]);
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/[:：]$/, "");
}

function pickText(sections: Map<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = sections.get(key);
    if (value) {
      return stripListMarkers(value).join(" ").trim();
    }
  }
  return "";
}

function pickList(sections: Map<string, string>, keys: string[]): string[] {
  for (const key of keys) {
    const value = sections.get(key);
    if (value) {
      return stripListMarkers(value);
    }
  }
  return [];
}

function parseNrvv(sections: Map<string, string>): Record<string, unknown> | undefined {
  const need = compactRecord({
    need_id: "NEED-1",
    statement: pickText(sections, ["need"]),
    stakeholder: pickText(sections, ["stakeholder / user", "stakeholder", "user"]),
    situation: pickText(sections, ["situation"]),
    pain_or_risk: pickText(sections, ["pain / risk", "pain", "risk"]),
    desired_operational_outcome: pickText(sections, ["desired operational outcome", "desired outcome"])
  });
  const requirements = parseRequirements(pickList(sections, ["requirement", "requirements"]));
  const verification = parseVerification(pickList(sections, ["verification"]));
  const validation = compactRecord({
    validation_scenario_id: "VAL-1",
    scenario: pickText(sections, ["validation scenario", "validation"]),
    intended_environment: pickText(sections, ["intended environment", "environment"]),
    success_criteria: pickList(sections, ["validation success criteria", "success criteria"]),
    evidence_expected: pickList(sections, ["validation evidence expected", "validation evidence"]),
    validation_status: pickText(sections, ["validation status"])
  });
  const gaps = parseGaps(pickList(sections, ["nrvv notes", "gaps"]));

  const nrvv = compactRecord({
    need: hasValue(need) ? need : undefined,
    requirements: requirements.length > 0 ? requirements : undefined,
    verification: verification.length > 0 ? verification : undefined,
    validation: hasValue(validation) ? validation : undefined,
    gaps: hasValue(gaps) ? gaps : undefined
  });
  return hasValue(nrvv) ? nrvv : undefined;
}

function parseRequirements(lines: string[]): Record<string, unknown>[] {
  return lines.map((line, index) => {
    const match = line.match(/^(REQ-[A-Za-z0-9_.-]+)\s*[:|-]\s*(.+)$/i);
    const requirementId = match?.[1] ?? `REQ-${index + 1}`;
    const statement = match?.[2] ?? line;
    return {
      requirement_id: requirementId,
      statement,
      source_need_ref: "NEED-1"
    };
  }).filter((item) => hasValue(item.statement));
}

function parseVerification(lines: string[]): Record<string, unknown>[] {
  return lines.map((line, index) => {
    const match = line.match(/^(REQ-[A-Za-z0-9_.-]+)(?:\s+verification method)?\s*[:|-]\s*(.+)$/i);
    const requirementRef = match?.[1] ?? `REQ-${index + 1}`;
    const rest = match?.[2] ?? line;
    const parts = rest.split("|").map((part) => part.trim()).filter(Boolean);
    return compactRecord({
      requirement_ref: requirementRef,
      method: parts[0] || rest,
      success_criteria: parts[1],
      evidence_expected: parts[2]
    });
  }).filter((item) => hasValue(item.method));
}

function parseGaps(lines: string[]): Record<string, unknown> {
  const result: Record<string, string[]> = {
    need_to_requirement_gap: [],
    requirement_to_verification_gap: [],
    verification_to_validation_gap: [],
    open_questions_for_human: []
  };
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = rawKey.trim().toLowerCase();
    if (!value) {
      continue;
    }
    if (key.includes("need-to-requirement")) {
      result.need_to_requirement_gap.push(value);
    } else if (key.includes("requirement-to-verification")) {
      result.requirement_to_verification_gap.push(value);
    } else if (key.includes("verification-to-validation")) {
      result.verification_to_validation_gap.push(value);
    } else if (key.includes("open question")) {
      result.open_questions_for_human.push(value);
    }
  }
  return compactRecord(result);
}

function compactRecord(source: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (hasValue(value)) {
      output[key] = value;
    }
  }
  return output;
}

function stripListMarkers(value: string): string[] {
  return value.split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""))
    .filter(Boolean);
}

function firstParagraph(markdown: string): string {
  return markdown.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
}

function normalizeRiskTier(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ["low", "medium", "high", "critical"].includes(normalized) ? normalized : "medium";
}
