import path from "node:path";
import { decide, primaryReason } from "./decision.js";
import { detectChangedFiles } from "./git.js";
import { loadArtifacts, writeYamlFile } from "./artifacts.js";
import { evaluateRules } from "./rules.js";
import { matchesAny, uniquePaths } from "./path-match.js";
import type { CheckOptions, CheckResult } from "./types.js";

export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const workspace = path.resolve(options.workspace);
  const changedFiles = uniquePaths(options.changedFiles && options.changedFiles.length > 0 ? options.changedFiles : detectChangedFiles(workspace));
  const artifacts = loadArtifacts(workspace, options.rulesetPath);
  const findings = [...evaluateRules(artifacts, changedFiles, { mode: options.mode ?? "pr" }), ...(options.additionalFindings ?? [])];
  const decision = decide(findings);
  const reason = primaryReason(findings);
  const evidenceBundle = buildEvidenceBundle({
    artifacts,
    changedFiles,
    findings,
    decision,
    reason,
    prRef: options.prRef
  });
  const evidenceBundlePath = outputPath(workspace, options.evidenceBundlePath);
  writeYamlFile(evidenceBundlePath, { approval_evidence_bundle: evidenceBundle });

  return {
    decision,
    mergeReady: decision === "PASS" || decision === "WARN",
    primaryReason: reason,
    findings,
    changedFiles,
    evidenceBundlePath,
    evidenceBundle
  };
}

function outputPath(workspace: string, requestedPath: string | undefined): string {
  if (!requestedPath) {
    return path.join(workspace, ".kc", "evidence_bundle.generated.yaml");
  }
  return path.isAbsolute(requestedPath) ? requestedPath : path.join(workspace, requestedPath);
}

interface BundleInput {
  artifacts: ReturnType<typeof loadArtifacts>;
  changedFiles: string[];
  findings: ReturnType<typeof evaluateRules>;
  decision: string;
  reason: string;
  prRef?: string;
}

function buildEvidenceBundle(input: BundleInput): Record<string, unknown> {
  const plan = input.artifacts.plan;
  const approval = input.artifacts.approval;
  const evidence = input.artifacts.evidence ?? {};
  const nrvvTrace = buildNrvvTrace(input.artifacts.issue, evidence);

  const bundle: Record<string, unknown> = {
    bundle_id: stringValue(evidence.bundle_id) || "AEB-GENERATED",
    issue_ref: evidence.issue_ref ?? input.artifacts.issue?.issue_ref ?? plan?.issue_ref,
    plan_ref: evidence.plan_ref ?? plan?.plan_id,
    approval_ref: evidence.approval_ref ?? approval?.approval_id,
    pr_ref: input.prRef ?? evidence.pr_ref,
    agent_ref: evidence.agent_ref ?? readPath(plan, ["agent", "agent_id"]),
    diff_summary: {
      changed_files: input.changedFiles,
      out_of_scope_files: input.findings.filter((finding) => finding.ruleId === "KC-AE-005").map((finding) => finding.path).filter(Boolean)
    },
    plan_diff_trace: buildPlanDiffTrace(plan, input.changedFiles),
    verification_evidence: evidence.verification_evidence ?? [],
    validation_evidence: evidence.validation_evidence ?? [],
    findings: input.findings.map((finding) => ({
      rule_id: finding.ruleId,
      severity: finding.severity,
      hold_reason_code: finding.reasonCode,
      message: finding.message,
      path: finding.path
    })),
    decision: {
      branch: input.decision === "PASS" || input.decision === "WARN" ? "execute" : input.decision === "FAIL" ? "reject" : "hold",
      status: input.decision,
      merge_ready: input.decision === "PASS" || input.decision === "WARN",
      primary_reason: input.reason
    },
    generated_at: new Date().toISOString()
  };
  if (nrvvTrace) {
    bundle.nrvv_trace = nrvvTrace;
  }
  return bundle;
}

function buildPlanDiffTrace(plan: Record<string, unknown> | undefined, changedFiles: string[]): Record<string, unknown>[] {
  const planItems = arrayRecords(plan?.plan_items).map((item) => ({
    id: stringValue(item.id) || "plan_item",
    expectedFiles: stringArray(item.expected_files),
    requirementRefs: stringArray(item.requirement_refs)
  })).filter((item) => item.expectedFiles.length > 0);
  if (planItems.length === 0) {
    return [];
  }

  const mapped = new Set<string>();
  const trace = planItems.map((item) => {
    const actualFiles = changedFiles.filter((file) => matchesExpected(file, item.expectedFiles));
    for (const file of actualFiles) {
      mapped.add(file);
    }
    return {
      plan_item_id: item.id,
      requirement_refs: item.requirementRefs,
      expected_files: item.expectedFiles,
      actual_files: actualFiles,
      status: actualFiles.length > 0 ? "implemented" : "not_touched"
    };
  });

  for (const file of changedFiles.filter((changedFile) => !mapped.has(changedFile))) {
    trace.push({
      plan_item_id: "unmapped",
      requirement_refs: [],
      expected_files: [],
      actual_files: [file],
      status: "unmapped_change"
    });
  }

  return trace;
}

function matchesExpected(file: string, expectedFiles: string[]): boolean {
  return matchesAny(file, expectedFiles);
}

function buildNrvvTrace(issue: Record<string, unknown> | undefined, evidence: Record<string, unknown>): Record<string, unknown> | undefined {
  const nrvv = recordValue(issue?.nrvv);
  if (!nrvv) {
    return recordValue(evidence.nrvv_trace);
  }

  const verificationEvidence = arrayRecords(evidence.verification_evidence);
  const validationEvidence = arrayRecords(evidence.validation_evidence);
  const verificationRefs = evidenceRefs(verificationEvidence);
  const validationRefs = evidenceRefs(validationEvidence);
  const verificationEntries = arrayRecords(nrvv.verification);
  const verificationByRequirement = new Set(verificationEntries.map((item) => stringValue(item.requirement_ref)).filter(Boolean));
  const explicitEvidenceMapping = verificationEvidence.some((item) => stringArray(item.requirement_refs).length > 0);
  const gaps = recordValue(nrvv.gaps);
  const validation = recordValue(nrvv.validation);
  const validationEvidencePassed = validationEvidence.some((item) => stringValue(item.status).toLowerCase() === "passed");
  const validationStatus = stringValue(evidence.validation_status) || (validationEvidencePassed ? "passed" : "") || stringValue(validation?.validation_status) || "pending";
  const validationPassed = validationStatus.toLowerCase() === "passed" && validationRefs.length > 0;

  const trace: Record<string, unknown> = {
    needs: buildNeedTrace(nrvv, validationPassed ? validationRefs : []),
    requirements: arrayRecords(nrvv.requirements).map((requirement) => {
      const requirementId = stringValue(requirement.requirement_id) || "requirement";
      const hasVerification = verificationByRequirement.has(requirementId);
      const mappedEvidenceRefs = evidenceRefs(verificationEvidence.filter((item) => stringArray(item.requirement_refs).includes(requirementId)));
      const effectiveEvidenceRefs = explicitEvidenceMapping ? mappedEvidenceRefs : hasVerification ? verificationRefs : [];
      return {
        requirement_id: requirementId,
        status: effectiveEvidenceRefs.length > 0 ? "verified" : hasVerification ? "verification_planned" : "verification_missing",
        verification_evidence_refs: effectiveEvidenceRefs
      };
    }),
    verification_summary: {
      status: verificationRefs.length > 0 ? "passed" : verificationEntries.length > 0 ? "planned" : "missing",
      evidence_refs: verificationRefs
    },
    validation_summary: {
      status: validationStatus,
      evidence_refs: validationRefs,
      gap: firstString(readPath(gaps, ["verification_to_validation_gap"]))
    },
    unresolved_gaps: buildNrvvGaps(gaps)
  };
  return trace;
}

function buildNeedTrace(nrvv: Record<string, unknown>, validationRefs: string[]): Record<string, unknown>[] {
  const need = recordValue(nrvv.need);
  if (!need) {
    return [];
  }
  return [{
    need_id: stringValue(need.need_id) || "NEED-1",
    status: validationRefs.length > 0 ? "addressed" : "validation_pending",
    evidence_refs: validationRefs
  }];
}

function buildNrvvGaps(gaps: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!gaps) {
    return [];
  }
  const entries: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(gaps)) {
    for (const statement of stringArray(value)) {
      entries.push({ type: key, statement });
    }
  }
  return entries;
}

function evidenceRefs(items: Record<string, unknown>[]): string[] {
  return items.map((item) => stringValue(item.evidence_id) || stringValue(item.ref)).filter(Boolean);
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    return stringValue(value[0]);
  }
  return stringValue(value);
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
