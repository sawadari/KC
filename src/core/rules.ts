import type { Finding, FindingSeverity, LoadedArtifacts } from "./types.js";
import { matchesAny } from "./path-match.js";

const approvedValues = new Set(["approved", "approved_with_conditions"]);
const riskyTiers = new Set(["medium", "high", "critical"]);
const highRiskTiers = new Set(["high", "critical"]);
const knownRuleIds = [
  "KC-AE-001",
  "KC-AE-002",
  "KC-AE-003",
  "KC-AE-004",
  "KC-AE-005",
  "KC-AE-006",
  "KC-AE-007",
  "KC-AE-008",
  "KC-AE-009",
  "KC-AE-010",
  "KC-AE-011",
  "KC-AE-012",
  "KC-AE-013",
  "KC-AE-014",
  "KC-AE-015",
  "KC-AE-016",
  "KC-AE-017",
  "KC-AE-018",
  "KC-AE-019",
  "KC-AE-020",
  "KC-AE-021",
  "KC-AE-022",
  "KC-NRVV-001",
  "KC-NRVV-002",
  "KC-NRVV-003",
  "KC-NRVV-004",
  "KC-NRVV-005",
  "KC-NRVV-006",
  "KC-NRVV-007",
  "KC-NRVV-008"
] as const;
const knownRuleIdSet = new Set<string>(knownRuleIds);
const placeholderValues = new Set(["PLAN-123", "APR-123", "AEB-123", "github-user", "issuecomment-approval", "candidate:unlinked", "TBD", "example"]);

export function evaluateRules(artifacts: LoadedArtifacts, changedFiles: string[], options: { mode?: "pr" | "current" } = {}): Finding[] {
  const policy = resolveRulePolicy(artifacts.ruleset);
  const findings: Finding[] = [...artifacts.loadFindings, ...policy.findings];
  const add = (finding: Finding): void => {
    findings.push(applySeverityOverride(finding, policy));
  };

  const issue = artifacts.issue;
  const plan = artifacts.plan;
  const approval = artifacts.approval;
  const envelope = artifacts.envelope;
  const evidence = artifacts.evidence;
  const current = artifacts.current;
  const changeRequest = artifacts.changeRequest;

  if (isRuleEnabled(policy, "KC-AE-001")) {
    if (!issue) {
      add(error("KC-AE-001", "missing_issue", ".kc/issue.yaml is required."));
    } else {
      requireField(add, issue, "problem_statement", "KC-AE-001", "missing_problem_statement");
      requireField(add, issue, "expected_outcome", "KC-AE-001", "missing_expected_outcome");
      requireNonEmptyArray(add, issue, "acceptance_criteria", "KC-AE-001", "missing_acceptance_criteria");
      requireField(add, issue, "risk_tier", "KC-AE-001", "missing_risk_tier");
      requireNonEmptyArray(add, issue, "non_goals", "KC-AE-001", "missing_non_goals");
    }
  }

  const riskTier = stringValue(issue?.risk_tier).toLowerCase();
  if (isRuleEnabled(policy, "KC-AE-002") && issue && riskyTiers.has(riskTier)) {
    const validationScenario = issue.validation_scenario;
    const validationStatus = stringValue(issue.validation_status).toLowerCase();
    if (!hasValue(validationScenario) && validationStatus !== "pending") {
      add(error("KC-AE-002", "missing_validation_scenario", "Medium/high/critical issues require validation_scenario or validation_status=pending."));
    } else if (!hasValue(validationScenario) && validationStatus === "pending") {
      add(warn("KC-AE-002", "validation_pending", "Validation scenario is pending and must be resolved before treating validation as passed."));
    }
  }

  if (isRuleEnabled(policy, "KC-AE-015") && issue && highRiskTiers.has(riskTier)) {
    const validationStatus = stringValue(issue.validation_status).toLowerCase();
    if (validationStatus === "pending" && !hasExceptionBasis(issue, approval, evidence)) {
      add(error("KC-AE-015", "high_risk_validation_pending", "High/critical risk issues cannot keep validation_status=pending without exception_basis."));
    }
  }

  const nrvv = recordValue(issue?.nrvv);
  const nrvvActive = Boolean(issue && (hasValue(nrvv) || booleanValue(issue.nrvv_required)));
  const nrvvRequirements = arrayRecords(nrvv?.requirements);
  const nrvvVerification = arrayRecords(nrvv?.verification);
  const nrvvValidation = recordValue(nrvv?.validation);
  const nrvvGaps = recordValue(nrvv?.gaps);
  if (nrvvActive) {
    if (isRuleEnabled(policy, "KC-NRVV-001") && riskyTiers.has(riskTier) && !hasValue(nrvv?.need)) {
      add(warn("KC-NRVV-001", "missing_nrvv_need", "NRVV-enabled medium/high/critical issues should include nrvv.need."));
    }
    if (isRuleEnabled(policy, "KC-NRVV-002") && nrvvRequirements.length === 0) {
      add(warn("KC-NRVV-002", "missing_nrvv_requirements", "NRVV-enabled issues should include at least one nrvv.requirements[] entry."));
    }
    if (isRuleEnabled(policy, "KC-NRVV-003")) {
      for (const requirement of nrvvRequirements) {
        const requirementId = stringValue(requirement.requirement_id) || "requirement";
        if (!hasValue(requirement.source_need_ref)) {
          add(warn("KC-NRVV-003", "missing_requirement_need_trace", `${requirementId} should include source_need_ref.`));
        }
      }
    }
    if (isRuleEnabled(policy, "KC-NRVV-004")) {
      const verifiedRefs = new Set(nrvvVerification.map((item) => stringValue(item.requirement_ref)).filter(Boolean));
      for (const requirement of nrvvRequirements) {
        const requirementId = stringValue(requirement.requirement_id);
        if (requirementId && !verifiedRefs.has(requirementId)) {
          add(warn("KC-NRVV-004", "missing_requirement_verification", `${requirementId} should have a matching nrvv.verification[].requirement_ref.`));
        }
      }
    }
    if (isRuleEnabled(policy, "KC-NRVV-005")) {
      const nrvvValidationStatus = stringValue(nrvvValidation?.validation_status).toLowerCase();
      if (nrvvValidationStatus === "passed" && arrayRecords(evidence?.validation_evidence).length === 0) {
        add(warn("KC-NRVV-005", "validation_without_validation_evidence", "NRVV validation_status=passed should be supported by validation evidence, not inferred from verification."));
      }
    }
    if (isRuleEnabled(policy, "KC-NRVV-006") && hasValue(nrvvValidation) && !hasValue(nrvvGaps?.verification_to_validation_gap)) {
      add(warn("KC-NRVV-006", "missing_verification_to_validation_gap", "NRVV-enabled issues should explicitly state the Verification-to-Validation gap, even if the gap is accepted as none."));
    }
    if (isRuleEnabled(policy, "KC-NRVV-007") && highRiskTiers.has(riskTier) && !hasValue(nrvvValidation?.intended_environment)) {
      add(warn("KC-NRVV-007", "missing_validation_intended_environment", "High/critical NRVV issues should include validation.intended_environment."));
    }
  }

  if (isRuleEnabled(policy, "KC-AE-003") && !plan) {
    add(error("KC-AE-003", "missing_approved_plan", ".kc/plan.yaml is required for an agent-governed PR."));
  }

  if (isRuleEnabled(policy, "KC-AE-004")) {
    if (!approval) {
      add(error("KC-AE-004", "missing_plan_approval", ".kc/approval.yaml is required before implementation is merge ready."));
    } else {
      const decision = stringValue(approval.decision);
      if (!approvedValues.has(decision)) {
        add(error("KC-AE-004", "plan_not_approved", `Plan approval decision must be approved or approved_with_conditions, got ${decision || "empty"}.`));
      }
    }

    const planStatus = stringValue(plan?.status);
    if (plan && planStatus && !approvedValues.has(planStatus)) {
      add(error("KC-AE-004", "plan_status_not_approved", `Plan status must be approved or approved_with_conditions, got ${planStatus}.`));
    }
  }

  if (isRuleEnabled(policy, "KC-AE-013") && approval && approvedValues.has(stringValue(approval.decision))) {
    const humanApproval = recordValue(approval.human_approval);
    const actor = stringValue(humanApproval?.actor);
    const source = stringValue(humanApproval?.source);
    const ref = stringValue(humanApproval?.ref);
    if (!actor || !source || !ref) {
      add(error("KC-AE-013", "missing_human_approval_evidence", "Approved plans require human_approval.actor, human_approval.source, and human_approval.ref."));
    }
  }

  if (isRuleEnabled(policy, "KC-AE-014")) {
    for (const finding of placeholderFindings({ issue, plan, approval, envelope, evidence, changeRequest })) {
      add(finding);
    }
  }

  if (options.mode !== "current" && isRuleEnabled(policy, "KC-AE-021") && hasReusableFinalizedArtifacts(current, evidence, changedFiles)) {
    add(error(
      "KC-AE-021",
      "stale_active_artifact_for_pr",
      "Current KC work is finalized and inactive. This PR changes files but does not establish a new active KC issue/plan/approval."
    ));
  }

  const approvedScope = stringArray(approval?.approved_scope);
  const changeRequestScope = stringArray(changeRequest?.requested_scope_addition);
  const changeRequestStatus = stringValue(changeRequest?.status);
  const changeRequestApproved = approvedValues.has(changeRequestStatus);
  if (isRuleEnabled(policy, "KC-AE-022") && changeRequest && changeRequestScope.length > 0) {
    if (!hasValue(changeRequest.target_plan_id)) {
      add(error("KC-AE-022", "missing_change_request_target_plan", "Plan change requests require target_plan_id."));
    }
    const filesInRequestedScope = changedFiles.filter((file) => matchesAny(file, changeRequestScope));
    if (filesInRequestedScope.length > 0 && !changeRequestApproved) {
      add(error("KC-AE-022", "pending_plan_change_request", "Requested scope additions require approved change_request.status before implementation is merge ready."));
    }
    if (changeRequestApproved && !hasHumanApprovalEvidence(changeRequest)) {
      add(error("KC-AE-022", "missing_change_request_approval_evidence", "Approved change requests require human_approval.actor, human_approval.source, and human_approval.ref."));
    }
  }
  const baseAllowedFiles = approvedScope.length > 0 ? approvedScope : stringArray(readPath(plan, ["scope", "allowed_files"]));
  const allowedFiles = changeRequestApproved ? [...baseAllowedFiles, ...changeRequestScope] : baseAllowedFiles;
  if (isRuleEnabled(policy, "KC-AE-005") && changedFiles.length > 0 && allowedFiles.length > 0) {
    for (const file of changedFiles) {
      if (!matchesAny(file, allowedFiles)) {
        add(error("KC-AE-005", "scope_violation", `${file} is outside approved plan scope.`, file));
      }
    }
  }

  const prohibitedFiles = [
    ...stringArray(readPath(plan, ["scope", "prohibited_files"])),
    ...stringArray(readPath(envelope, ["authority_envelope", "prohibited_paths"]))
  ];
  if (nrvvActive && isRuleEnabled(policy, "KC-NRVV-008") && stringArray(issue?.non_goals).length > 0 && prohibitedFiles.length === 0) {
    add(warn("KC-NRVV-008", "non_goals_not_reflected_as_constraints", "NRVV non-goals should be reflected in plan.prohibited_files, authority prohibited paths, or approval conditions."));
  }
  if (isRuleEnabled(policy, "KC-AE-006")) {
    for (const file of changedFiles) {
      if (matchesAny(file, prohibitedFiles)) {
        add(error("KC-AE-006", "prohibited_file_changed", `${file} matches a prohibited path.`, file));
      }
    }
  }

  if (isRuleEnabled(policy, "KC-AE-016") && changedFiles.length > 0 && plan) {
    const planItems = arrayRecords(plan.plan_items);
    const expectedByItem = planItems.map((item) => ({
      id: stringValue(item.id) || "plan_item",
      expectedFiles: stringArray(item.expected_files)
    })).filter((item) => item.expectedFiles.length > 0);
    if (expectedByItem.length > 0) {
      for (const file of changedFiles) {
        if (!expectedByItem.some((item) => matchesAny(file, item.expectedFiles))) {
          const coveredByApprovedChangeRequest = changeRequestApproved && matchesAny(file, changeRequestScope);
          if (!coveredByApprovedChangeRequest) {
            add(error("KC-AE-016", "unmapped_plan_item_change", `${file} is not mapped to any plan_items[].expected_files entry.`, file));
          }
        }
      }
      if (!hasValue(evidence?.plan_diff_trace)) {
        add(warn("KC-AE-016", "plan_item_trace_missing", "Evidence bundle should include plan_diff_trace for plan item accountability."));
      }
    }
  }

  if (options.mode === "current") {
    if (isRuleEnabled(policy, "KC-AE-017") && !current) {
      add(error("KC-AE-017", "missing_current_state", ".kc/current.yaml is required for current-mode lifecycle checks."));
    }

    const lifecycleState = stringValue(current?.lifecycle_state ?? evidence?.lifecycle_state).toLowerCase();
    const finalStatus = stringValue(current?.final_status ?? evidence?.final_status).toLowerCase();
    const completed = isCompletedLifecycle(lifecycleState, finalStatus, current);

    if (completed && isRuleEnabled(policy, "KC-AE-017")) {
      const issueState = stringValue(issue?.issue_state).toLowerCase();
      if (["draft", "ready_for_plan", "plan_requested", "pending_plan_approval"].includes(issueState)) {
        add(error("KC-AE-017", "lifecycle_state_stale", `Completed work must not keep issue_state=${issueState}.`));
      }
    }

    if (completed && isRuleEnabled(policy, "KC-AE-018")) {
      const prRef = stringValue(current?.pr_ref ?? evidence?.pr_ref);
      if (!prRef || prRef === "pending") {
        add(error("KC-AE-018", "pending_pr_ref_after_completion", "Completed work requires a final pr_ref, not pending."));
      }
    }

    if (completed && isRuleEnabled(policy, "KC-AE-019")) {
      const requiredActions = arrayRecords(readPath(evidence, ["decision", "required_actions"])).length > 0
        ? arrayRecords(readPath(evidence, ["decision", "required_actions"]))
        : stringArray(readPath(evidence, ["decision", "required_actions"]));
      if (requiredActions.length > 0) {
        add(error("KC-AE-019", "required_actions_after_completion", "Completed work must not keep decision.required_actions."));
      }
    }

    if (completed && isRuleEnabled(policy, "KC-AE-020")) {
      const finalBundleRef = stringValue(current?.final_evidence_bundle_ref ?? evidence?.final_evidence_bundle_ref ?? evidence?.archive_ref);
      if (!finalBundleRef) {
        add(error("KC-AE-020", "missing_finalized_bundle_archive", "Finalized work requires final_evidence_bundle_ref or archive_ref."));
      }
    }
  }

  const implementationChanged = changedFiles.some((file) => !file.startsWith(".kc/") && !file.toLowerCase().endsWith(".md"));
  const verification = arrayRecords(evidence?.verification_evidence);
  if (isRuleEnabled(policy, "KC-AE-007") && implementationChanged && verification.length === 0) {
    add(error("KC-AE-007", "missing_verification_evidence", "Implementation changes require CI result or verification evidence."));
  }

  const validation = arrayRecords(evidence?.validation_evidence);
  const validationStatus = stringValue(evidence?.validation_status).toLowerCase();
  if (isRuleEnabled(policy, "KC-AE-008") && validationStatus === "passed" && validation.length === 0) {
    add(error("KC-AE-008", "validation_inferred_from_verification", "validation_status=passed requires validation evidence and cannot be inferred from verification."));
  }

  if (isRuleEnabled(policy, "KC-AE-009")) {
    for (const condition of arrayRecords(approval?.conditions)) {
      const evidenceRequired = stringValue(condition.evidence_required);
      if (!evidenceRequired) {
        continue;
      }

      if (!conditionEvidenceSatisfied(evidenceRequired, findings, verification, validation, approval)) {
        const id = stringValue(condition.id) || "condition";
        add(error("KC-AE-009", "missing_condition_evidence", `${id} requires evidence type ${evidenceRequired}.`));
      }
    }
  }

  const agentId = stringValue(plan?.agent_id) || stringValue(readPath(plan, ["agent", "agent_id"])) || stringValue(envelope?.agent_id);
  if (isRuleEnabled(policy, "KC-AE-010") && agentId) {
    const planRef = evidence?.plan_ref ?? plan?.plan_id;
    const diffRef = evidence?.diff_ref ?? evidence?.diff_summary;
    if (!hasValue(planRef) || !hasValue(diffRef)) {
      add(error("KC-AE-010", "missing_agent_audit_refs", "Agent-governed work requires plan_ref and diff_ref or diff_summary in the evidence bundle."));
    }
  }

  if (isRuleEnabled(policy, "KC-AE-011") && issue && highRiskTiers.has(riskTier)) {
    const rollbackPath = evidence?.rollback_path ?? readPath(envelope, ["rollback_path"]) ?? evidence?.no_rollback_justification;
    if (!hasValue(rollbackPath)) {
      add(error("KC-AE-011", "missing_rollback_path", "High/critical risk changes require rollback_path or no_rollback_justification."));
    }
  }

  const holdOrFail = findings.some((finding) => finding.severity === "error");
  if (isRuleEnabled(policy, "KC-AE-012") && holdOrFail) {
    add({
      ruleId: "KC-AE-012",
      severity: "info",
      reasonCode: "merge_not_ready",
      message: "One or more blocking findings remain; merge_ready=false."
    });
  }

  return findings;
}

interface RulePolicy {
  enabledRules: Set<string>;
  severityOverrides: Map<string, FindingSeverity>;
  findings: Finding[];
}

function resolveRulePolicy(ruleset: Record<string, unknown> | undefined): RulePolicy {
  const findings: Finding[] = [];
  const root = unwrapRuleset(ruleset);
  const configuredRules = stringArray(root?.rules);
  const enabledRules = configuredRules.length > 0 ? new Set<string>() : new Set<string>(knownRuleIds);

  for (const ruleId of configuredRules) {
    if (knownRuleIdSet.has(ruleId)) {
      enabledRules.add(ruleId);
    } else {
      findings.push(error("KC-AE-000", "unknown_rule_id", `Unknown rule id in ruleset.rules: ${ruleId}.`));
    }
  }

  const severityOverrides = new Map<string, FindingSeverity>();
  const rawOverrides = root?.severity_overrides;
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [ruleId, severity] of Object.entries(rawOverrides)) {
      if (!knownRuleIdSet.has(ruleId)) {
        findings.push(error("KC-AE-000", "unknown_severity_override_rule", `Unknown rule id in ruleset.severity_overrides: ${ruleId}.`));
        continue;
      }
      if (severity !== "info" && severity !== "warning" && severity !== "error") {
        findings.push(error("KC-AE-000", "invalid_severity_override", `Invalid severity override for ${ruleId}: ${String(severity)}.`));
        continue;
      }
      severityOverrides.set(ruleId, severity);
    }
  }

  return { enabledRules, severityOverrides, findings };
}

function unwrapRuleset(ruleset: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ruleset) {
    return undefined;
  }
  const wrapped = ruleset.ruleset;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }
  return ruleset;
}

function isRuleEnabled(policy: RulePolicy, ruleId: string): boolean {
  return policy.enabledRules.has(ruleId);
}

function applySeverityOverride(finding: Finding, policy: RulePolicy): Finding {
  const override = policy.severityOverrides.get(finding.ruleId);
  if (!override) {
    return finding;
  }
  return { ...finding, severity: override };
}

function requireField(add: (finding: Finding) => void, source: Record<string, unknown>, key: string, ruleId: string, reasonCode: string): void {
  if (!hasValue(source[key])) {
    add(error(ruleId, reasonCode, `${key} is required.`));
  }
}

function requireNonEmptyArray(add: (finding: Finding) => void, source: Record<string, unknown>, key: string, ruleId: string, reasonCode: string): void {
  if (stringArray(source[key]).length === 0) {
    add(error(ruleId, reasonCode, `${key} must contain at least one item.`));
  }
}

function conditionEvidenceSatisfied(evidenceRequired: string, findings: Finding[], verification: Record<string, unknown>[], validation: Record<string, unknown>[], approval: Record<string, unknown> | undefined): boolean {
  if (evidenceRequired === "diff_scope_check") {
    return !findings.some((finding) => finding.ruleId === "KC-AE-005" || finding.ruleId === "KC-AE-006");
  }
  if (evidenceRequired === "human_approval_evidence") {
    const humanApproval = recordValue(approval?.human_approval);
    return Boolean(stringValue(humanApproval?.actor) && stringValue(humanApproval?.source) && stringValue(humanApproval?.ref));
  }
  if (evidenceRequired === "unit_test" || evidenceRequired === "github_actions") {
    return verification.some((item) => hasValue(item.ref) || hasValue(item.status));
  }
  if (evidenceRequired === "validation_report") {
    return validation.some((item) => stringValue(item.status).toLowerCase() !== "pending" && (hasValue(item.ref) || hasValue(item.status)));
  }
  return verification.some((item) => stringValue(item.type) === evidenceRequired) || validation.some((item) => stringValue(item.type) === evidenceRequired);
}

function hasExceptionBasis(issue: Record<string, unknown>, approval: Record<string, unknown> | undefined, evidence: Record<string, unknown> | undefined): boolean {
  return hasValue(issue.exception_basis)
    || hasValue(issue.validation_exception_basis)
    || hasValue(approval?.exception_basis)
    || hasValue(evidence?.exception_basis)
    || hasValue(evidence?.validation_exception_basis);
}

function hasHumanApprovalEvidence(source: Record<string, unknown>): boolean {
  const humanApproval = recordValue(source.human_approval);
  return Boolean(stringValue(humanApproval?.actor) && stringValue(humanApproval?.source) && stringValue(humanApproval?.ref));
}

function isCompletedLifecycle(lifecycleState: string, finalStatus: string, current: Record<string, unknown> | undefined): boolean {
  if (["completed", "finalized", "archived"].includes(finalStatus) || ["completed", "finalized", "archived"].includes(lifecycleState)) {
    return true;
  }
  return current?.active_work === false && Boolean(finalStatus || lifecycleState);
}

function hasReusableFinalizedArtifacts(current: Record<string, unknown> | undefined, evidence: Record<string, unknown> | undefined, changedFiles: string[]): boolean {
  if (changedFiles.length === 0) {
    return false;
  }
  const lifecycleState = stringValue(current?.lifecycle_state ?? evidence?.lifecycle_state).toLowerCase();
  const finalStatus = stringValue(current?.final_status ?? evidence?.final_status).toLowerCase();
  const inactiveFinalized = current?.active_work === false || ["completed", "finalized", "archived"].includes(lifecycleState) || ["completed", "finalized", "archived"].includes(finalStatus);
  if (!inactiveFinalized) {
    return false;
  }
  const nonKcChanged = changedFiles.some((file) => !file.startsWith(".kc/"));
  if (!nonKcChanged) {
    return false;
  }
  return ![".kc/issue.yaml", ".kc/plan.yaml", ".kc/approval.yaml"].every((file) => changedFiles.includes(file));
}

function placeholderFindings(artifacts: Record<string, Record<string, unknown> | undefined>): Finding[] {
  const findings: Finding[] = [];
  for (const [artifactName, artifact] of Object.entries(artifacts)) {
    collectPlaceholderFindings(artifact, artifactName, findings);
  }
  return findings;
}

function collectPlaceholderFindings(value: unknown, path: string, findings: Finding[]): void {
  if (typeof value === "string") {
    if (isPlaceholder(value)) {
      findings.push(error("KC-AE-014", "placeholder_detected", `Active KC artifact contains placeholder value: ${value}.`, path));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPlaceholderFindings(item, `${path}[${index}]`, findings));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectPlaceholderFindings(item, `${path}.${key}`, findings);
  }
}

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (placeholderValues.has(trimmed)) {
    return true;
  }
  return trimmed === "github:org/repo"
    || trimmed.startsWith("github:org/repo/")
    || trimmed.includes("github.com/org/repo")
    || trimmed.includes("#issuecomment-approval");
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

function booleanValue(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  return typeof value === "string" && value.trim().toLowerCase() === "true";
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
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
