import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { loadArtifacts, writeYamlFile } from "./artifacts.js";

export interface ApprovalBriefOptions {
  workspace: string;
}

export interface ApprovalRecordOptions {
  workspace: string;
  choice: string;
  actor: string;
  source: string;
  ref: string;
  summary?: string;
}

export interface ApprovalRecordResult {
  decision: string;
  approvalPath: string;
  choice: ApprovalChoice;
}

export interface ApprovalChoice {
  number: "1" | "2" | "3" | "4";
  decision: "approved" | "approved_with_conditions" | "changes_requested" | "rejected";
  label: string;
}

const choices: ApprovalChoice[] = [
  { number: "1", decision: "approved", label: "Approve" },
  { number: "2", decision: "approved_with_conditions", label: "Approve with conditions" },
  { number: "3", decision: "changes_requested", label: "Request changes" },
  { number: "4", decision: "rejected", label: "Reject" }
];

export function renderApprovalBrief(options: ApprovalBriefOptions): string {
  const workspace = path.resolve(options.workspace);
  const artifacts = loadArtifacts(workspace, ".kc/ruleset.yaml");
  const issue = artifacts.issue ?? {};
  const plan = artifacts.plan ?? {};
  const approval = artifacts.approval ?? {};
  const allowedFiles = stringArray(readPath(plan, ["scope", "allowed_files"]));
  const approvedScope = stringArray(approval.approved_scope);
  const scope = approvedScope.length > 0 ? approvedScope : allowedFiles;
  const prohibited = stringArray(readPath(plan, ["scope", "prohibited_files"]));

  return [
    "# KC Approval Brief",
    "",
    `Issue: ${stringValue(plan.issue_ref) || stringValue(issue.issue_ref) || "unknown"}`,
    `Plan: ${stringValue(plan.plan_id) || stringValue(approval.target_plan_id) || "unknown"}`,
    `Risk tier: ${stringValue(issue.risk_tier) || "unknown"}`,
    "",
    "## Problem",
    "",
    stringValue(issue.problem_statement) || "TBD",
    "",
    "## Expected Outcome",
    "",
    stringValue(issue.expected_outcome) || stringValue(plan.interpreted_requirement) || "TBD",
    "",
    "## Approved Scope Candidate",
    "",
    ...bulletList(scope.length > 0 ? scope : ["TBD"]),
    "",
    "## Prohibited Paths",
    "",
    ...bulletList(prohibited.length > 0 ? prohibited : ["none recorded"]),
    "",
    "## Human Decision",
    "",
    "Reply with one number:",
    "",
    ...choices.map((choice) => `${choice.number}. ${choice.label}`),
    "",
    "After the human replies, mirror the decision to a durable source such as a GitHub Issue comment and record that URL in `.kc/approval.yaml`."
  ].join("\n");
}

export function recordApprovalChoice(options: ApprovalRecordOptions): ApprovalRecordResult {
  const workspace = path.resolve(options.workspace);
  const choice = normalizeApprovalChoice(options.choice);
  const actor = required(options.actor, "actor");
  const source = required(options.source, "source");
  const ref = required(options.ref, "ref");
  const artifacts = loadArtifacts(workspace, ".kc/ruleset.yaml");
  const approvalPath = path.join(workspace, ".kc", "approval.yaml");
  const approval = readApprovalYaml(approvalPath);
  const current = unwrapApproval(approval);
  const plan = artifacts.plan ?? {};

  const updated = {
    ...current,
    approval_id: stringValue(current.approval_id) || `APR-${stringValue(plan.plan_id) || "KC"}`,
    target_plan_id: stringValue(current.target_plan_id) || stringValue(plan.plan_id) || "unknown",
    decision: choice.decision,
    approver_role: stringValue(current.approver_role) || "human",
    timestamp: new Date().toISOString(),
    human_approval: {
      actor,
      source,
      ref,
      summary: options.summary?.trim() || choice.label,
      choice: choice.number
    },
    approved_scope: stringArray(current.approved_scope).length > 0 ? current.approved_scope : readPath(plan, ["scope", "allowed_files"]),
    conditions: Array.isArray(current.conditions) ? current.conditions : []
  };

  writeYamlFile(approvalPath, { plan_approval: updated });
  return { decision: choice.decision, approvalPath, choice };
}

export function normalizeApprovalChoice(input: string): ApprovalChoice {
  const normalized = input.trim().toLowerCase();
  const aliases: Record<string, string> = {
    approve: "1",
    approved: "1",
    "approve-with-conditions": "2",
    approved_with_conditions: "2",
    conditional: "2",
    changes: "3",
    "request-changes": "3",
    changes_requested: "3",
    reject: "4",
    rejected: "4"
  };
  const number = aliases[normalized] ?? normalized;
  const choice = choices.find((item) => item.number === number);
  if (!choice) {
    throw new Error(`Invalid approval choice: ${input}. Use 1, 2, 3, or 4.`);
  }
  return choice;
}

function readApprovalYaml(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const parsed = YAML.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function unwrapApproval(source: Record<string, unknown>): Record<string, unknown> {
  const wrapped = source.plan_approval;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }
  return source;
}

function bulletList(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function required(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`--${name} is required.`);
  }
  return trimmed;
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
