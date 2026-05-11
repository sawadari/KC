import type { Finding, LoadedArtifacts } from "./types.js";
import { matchesAny } from "./path-match.js";

const approvedValues = new Set(["approved", "approved_with_conditions"]);
const riskyTiers = new Set(["medium", "high", "critical"]);
const highRiskTiers = new Set(["high", "critical"]);

export function evaluateRules(artifacts: LoadedArtifacts, changedFiles: string[]): Finding[] {
  const findings: Finding[] = [...artifacts.loadFindings];

  const issue = artifacts.issue;
  const plan = artifacts.plan;
  const approval = artifacts.approval;
  const envelope = artifacts.envelope;
  const evidence = artifacts.evidence;

  if (!issue) {
    findings.push(error("KC-AE-001", "missing_issue", ".kc/issue.yaml is required."));
  } else {
    requireField(findings, issue, "problem_statement", "KC-AE-001", "missing_problem_statement");
    requireField(findings, issue, "expected_outcome", "KC-AE-001", "missing_expected_outcome");
    requireNonEmptyArray(findings, issue, "acceptance_criteria", "KC-AE-001", "missing_acceptance_criteria");
    requireField(findings, issue, "risk_tier", "KC-AE-001", "missing_risk_tier");
    requireNonEmptyArray(findings, issue, "non_goals", "KC-AE-001", "missing_non_goals");
  }

  const riskTier = stringValue(issue?.risk_tier).toLowerCase();
  if (issue && riskyTiers.has(riskTier)) {
    const validationScenario = issue.validation_scenario;
    const validationStatus = stringValue(issue.validation_status).toLowerCase();
    if (!hasValue(validationScenario) && validationStatus !== "pending") {
      findings.push(error("KC-AE-002", "missing_validation_scenario", "Medium/high/critical issues require validation_scenario or validation_status=pending."));
    } else if (!hasValue(validationScenario) && validationStatus === "pending") {
      findings.push(warn("KC-AE-002", "validation_pending", "Validation scenario is pending and must be resolved before treating validation as passed."));
    }
  }

  if (!plan) {
    findings.push(error("KC-AE-003", "missing_approved_plan", ".kc/plan.yaml is required for an agent-governed PR."));
  }

  if (!approval) {
    findings.push(error("KC-AE-004", "missing_plan_approval", ".kc/approval.yaml is required before implementation is merge ready."));
  } else {
    const decision = stringValue(approval.decision);
    if (!approvedValues.has(decision)) {
      findings.push(error("KC-AE-004", "plan_not_approved", `Plan approval decision must be approved or approved_with_conditions, got ${decision || "empty"}.`));
    }
  }

  const planStatus = stringValue(plan?.status);
  if (plan && planStatus && !approvedValues.has(planStatus)) {
    findings.push(error("KC-AE-004", "plan_status_not_approved", `Plan status must be approved or approved_with_conditions, got ${planStatus}.`));
  }

  const approvedScope = stringArray(approval?.approved_scope);
  const allowedFiles = approvedScope.length > 0 ? approvedScope : stringArray(readPath(plan, ["scope", "allowed_files"]));
  if (changedFiles.length > 0 && allowedFiles.length > 0) {
    for (const file of changedFiles) {
      if (!matchesAny(file, allowedFiles)) {
        findings.push(error("KC-AE-005", "scope_violation", `${file} is outside approved plan scope.`, file));
      }
    }
  }

  const prohibitedFiles = [
    ...stringArray(readPath(plan, ["scope", "prohibited_files"])),
    ...stringArray(readPath(envelope, ["authority_envelope", "prohibited_paths"]))
  ];
  for (const file of changedFiles) {
    if (matchesAny(file, prohibitedFiles)) {
      findings.push(error("KC-AE-006", "prohibited_file_changed", `${file} matches a prohibited path.`, file));
    }
  }

  const implementationChanged = changedFiles.some((file) => !file.startsWith(".kc/") && !file.toLowerCase().endsWith(".md"));
  const verification = arrayRecords(evidence?.verification_evidence);
  if (implementationChanged && verification.length === 0) {
    findings.push(error("KC-AE-007", "missing_verification_evidence", "Implementation changes require CI result or verification evidence."));
  }

  const validation = arrayRecords(evidence?.validation_evidence);
  const validationStatus = stringValue(evidence?.validation_status).toLowerCase();
  if (validationStatus === "passed" && validation.length === 0) {
    findings.push(error("KC-AE-008", "validation_inferred_from_verification", "validation_status=passed requires validation evidence and cannot be inferred from verification."));
  }

  for (const condition of arrayRecords(approval?.conditions)) {
    const evidenceRequired = stringValue(condition.evidence_required);
    if (!evidenceRequired) {
      continue;
    }

    if (!conditionEvidenceSatisfied(evidenceRequired, findings, verification, validation)) {
      const id = stringValue(condition.id) || "condition";
      findings.push(error("KC-AE-009", "missing_condition_evidence", `${id} requires evidence type ${evidenceRequired}.`));
    }
  }

  const agentId = stringValue(plan?.agent_id) || stringValue(readPath(plan, ["agent", "agent_id"])) || stringValue(envelope?.agent_id);
  if (agentId) {
    const planRef = evidence?.plan_ref ?? plan?.plan_id;
    const diffRef = evidence?.diff_ref ?? evidence?.diff_summary;
    if (!hasValue(planRef) || !hasValue(diffRef)) {
      findings.push(error("KC-AE-010", "missing_agent_audit_refs", "Agent-governed work requires plan_ref and diff_ref or diff_summary in the evidence bundle."));
    }
  }

  if (issue && highRiskTiers.has(riskTier)) {
    const rollbackPath = evidence?.rollback_path ?? readPath(envelope, ["rollback_path"]) ?? evidence?.no_rollback_justification;
    if (!hasValue(rollbackPath)) {
      findings.push(error("KC-AE-011", "missing_rollback_path", "High/critical risk changes require rollback_path or no_rollback_justification."));
    }
  }

  const holdOrFail = findings.some((finding) => finding.severity === "error");
  if (holdOrFail) {
    findings.push({
      ruleId: "KC-AE-012",
      severity: "info",
      reasonCode: "merge_not_ready",
      message: "One or more blocking findings remain; merge_ready=false."
    });
  }

  return findings;
}

function requireField(findings: Finding[], source: Record<string, unknown>, key: string, ruleId: string, reasonCode: string): void {
  if (!hasValue(source[key])) {
    findings.push(error(ruleId, reasonCode, `${key} is required.`));
  }
}

function requireNonEmptyArray(findings: Finding[], source: Record<string, unknown>, key: string, ruleId: string, reasonCode: string): void {
  if (stringArray(source[key]).length === 0) {
    findings.push(error(ruleId, reasonCode, `${key} must contain at least one item.`));
  }
}

function conditionEvidenceSatisfied(evidenceRequired: string, findings: Finding[], verification: Record<string, unknown>[], validation: Record<string, unknown>[]): boolean {
  if (evidenceRequired === "diff_scope_check") {
    return !findings.some((finding) => finding.ruleId === "KC-AE-005" || finding.ruleId === "KC-AE-006");
  }
  if (evidenceRequired === "unit_test" || evidenceRequired === "github_actions") {
    return verification.some((item) => hasValue(item.ref) || hasValue(item.status));
  }
  if (evidenceRequired === "validation_report") {
    return validation.some((item) => stringValue(item.status).toLowerCase() !== "pending" && (hasValue(item.ref) || hasValue(item.status)));
  }
  return verification.some((item) => stringValue(item.type) === evidenceRequired) || validation.some((item) => stringValue(item.type) === evidenceRequired);
}

function error(ruleId: string, reasonCode: string, message: string, filePath?: string): Finding {
  return { ruleId, severity: "error", reasonCode, message, path: filePath };
}

function warn(ruleId: string, reasonCode: string, message: string): Finding {
  return { ruleId, severity: "warning", reasonCode, message };
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item));
}

function readPath(source: unknown, pathParts: string[]): unknown {
  let cursor = source;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

