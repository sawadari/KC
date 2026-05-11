import fs from "node:fs";
import path from "node:path";
import { loadArtifacts } from "./artifacts.js";

export interface PromoteOptions {
  workspace: string;
  outputDir?: string;
}

export interface PromoteResult {
  outputDir: string;
  files: string[];
}

export function runPromote(options: PromoteOptions): PromoteResult {
  const workspace = path.resolve(options.workspace);
  const outputDir = path.resolve(workspace, options.outputDir ?? "reports/promotion");
  const artifacts = loadArtifacts(workspace, ".kc/ruleset.yaml");
  fs.mkdirSync(outputDir, { recursive: true });

  const context = {
    issueRef: stringValue(artifacts.issue?.issue_ref),
    planRef: stringValue(artifacts.plan?.plan_id),
    approvalRef: stringValue(artifacts.approval?.approval_id),
    bundleRef: stringValue(artifacts.evidence?.bundle_id),
    prRef: stringValue(artifacts.evidence?.pr_ref),
    requirement: stringValue(artifacts.plan?.interpreted_requirement) || stringValue(artifacts.issue?.expected_outcome),
    validation: stringify(artifacts.evidence?.validation_evidence),
    planTrace: stringify(artifacts.evidence?.plan_diff_trace),
    approvalConditions: stringify(artifacts.approval?.conditions),
    findings: stringify(artifacts.evidence?.findings),
    humanDecision: stringify(artifacts.approval?.human_approval)
  };

  const outputs: Record<string, string> = {
    "decision-ledger.candidate.md": decisionLedger(context),
    "requirements.candidate.md": requirements(context),
    "validation-scenarios.candidate.md": validationScenarios(context),
    "AGENTS.candidate.md": agentsCandidate(context),
    "test-oracle.candidate.md": testOracle(context)
  };

  const files: string[] = [];
  for (const [fileName, content] of Object.entries(outputs)) {
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, content, "utf8");
    files.push(filePath);
  }

  return { outputDir, files };
}

function decisionLedger(context: PromotionContext): string {
  return [
    "# DecisionLedger Candidate",
    "",
    "candidate_status: draft",
    "",
    "## Source References",
    refs(context),
    "",
    "## Candidate Decision",
    "",
    `- decision: execute_candidate`,
    `- rationale: ${context.requirement || "TBD"}`,
    `- human_decision_context: ${context.humanDecision || "TBD"}`,
    "- human_review_required: true"
  ].join("\n");
}

function requirements(context: PromotionContext): string {
  return [
    "# Requirements Candidate",
    "",
    "candidate_status: draft",
    "",
    "## Source References",
    refs(context),
    "",
    "## Candidate Requirement",
    "",
    context.requirement || "TBD"
  ].join("\n");
}

function validationScenarios(context: PromotionContext): string {
  return [
    "# Validation Scenarios Candidate",
    "",
    "candidate_status: draft",
    "",
    "## Source References",
    refs(context),
    "",
    "## Candidate Validation Evidence",
    "",
    context.validation || "No validation evidence captured.",
    "",
    "## Approval Conditions",
    "",
    context.approvalConditions || "No approval conditions captured."
  ].join("\n");
}

function agentsCandidate(context: PromotionContext): string {
  return [
    "# AGENTS.md Candidate Update",
    "",
    "candidate_status: draft",
    "",
    "## Source References",
    refs(context),
    "",
    "## Candidate Guidance",
    "",
    "- Keep Issue -> Plan -> Approval -> Implementation ordering.",
    "- Keep verification and validation evidence separate.",
    "- Do not treat AI-generated candidates as approval.",
    "- Review plan item trace and findings before promoting evidence into canonical project memory."
  ].join("\n");
}

function testOracle(context: PromotionContext): string {
  return [
    "# Test Oracle Candidate",
    "",
    "candidate_status: draft",
    "",
    "## Source References",
    refs(context),
    "",
    "## Candidate Oracle",
    "",
    `- Requirement under test: ${context.requirement || "TBD"}`,
    "- Expected evidence: deterministic KC check plus human-reviewed validation evidence.",
    "",
    "## Plan Item Trace",
    "",
    context.planTrace || "No plan item trace captured.",
    "",
    "## Findings History",
    "",
    context.findings || "No findings captured."
  ].join("\n");
}

interface PromotionContext {
  issueRef: string;
  planRef: string;
  approvalRef: string;
  bundleRef: string;
  prRef: string;
  requirement: string;
  validation: string;
  planTrace: string;
  approvalConditions: string;
  findings: string;
  humanDecision: string;
}

function refs(context: PromotionContext): string {
  return [
    `- issue_ref: ${context.issueRef || "TBD"}`,
    `- plan_ref: ${context.planRef || "TBD"}`,
    `- approval_ref: ${context.approvalRef || "TBD"}`,
    `- pr_ref: ${context.prRef || "TBD"}`,
    `- evidence_bundle_ref: ${context.bundleRef || "TBD"}`
  ].join("\n");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringify(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

