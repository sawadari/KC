import type { Finding } from "./types.js";
import { matchesAny } from "./path-match.js";

const requiredSections = ["Linked Issue", "Approved Plan", "Approval", "Verification", "Validation", "KC Evidence"];

export interface PullRequestEnforcementContext {
  body?: string;
  labels?: string[];
  changedFiles?: string[];
  config?: Record<string, unknown>;
}

export function validatePullRequestBody(body: string | undefined): Finding[] {
  const text = body ?? "";
  const findings: Finding[] = [];

  for (const section of requiredSections) {
    const content = readSection(text, section);
    if (content === undefined) {
      findings.push({
        ruleId: "KC-PR-001",
        severity: "error",
        reasonCode: "missing_pr_section",
        message: `PR body is missing required section: ${section}.`
      });
    } else if (content.trim().length === 0) {
      findings.push({
        ruleId: "KC-PR-001",
        severity: "error",
        reasonCode: "empty_pr_section",
        message: `PR body section is empty: ${section}.`
      });
    }
  }

  return findings;
}

export function shouldValidatePullRequestBody(context: PullRequestEnforcementContext): boolean {
  const enforcement = readEnforcement(context.config);
  if (enforcement.mode === "disabled") {
    return false;
  }
  if (enforcement.mode === "strict") {
    return true;
  }
  if (enforcement.mode !== "opt_in") {
    return true;
  }

  const requireWhen = enforcement.requireWhen;
  const labels = context.labels ?? [];
  if (requireWhen.labels.length > 0 && labels.some((label) => requireWhen.labels.includes(label))) {
    return true;
  }
  const marker = requireWhen.prBodyMarker || "KC: required";
  if ((context.body ?? "").includes(marker)) {
    return true;
  }
  if (requireWhen.changedPaths.length > 0 && (context.changedFiles ?? []).some((file) => matchesAny(file, requireWhen.changedPaths))) {
    return true;
  }
  return false;
}

export function linkedIssueNumbers(body: string | undefined): number[] {
  const text = body ?? "";
  const linkedIssue = readSection(text, "Linked Issue") ?? text;
  return [...new Set([...linkedIssue.matchAll(/#(\d+)/g)].map((match) => Number(match[1])).filter((number) => Number.isInteger(number)))];
}

function readSection(body: string, heading: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    return undefined;
  }
  const content: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    content.push(lines[index]);
  }
  return content.join("\n");
}

function readEnforcement(config: Record<string, unknown> | undefined): { mode: string; requireWhen: { labels: string[]; changedPaths: string[]; prBodyMarker: string } } {
  const root = recordValue(config?.kc) ?? config;
  const enforcement = recordValue(root?.enforcement);
  const mode = stringValue(enforcement?.mode) || "strict";
  const requireWhen = recordValue(enforcement?.require_when);
  return {
    mode,
    requireWhen: {
      labels: stringArray(requireWhen?.labels),
      changedPaths: stringArray(requireWhen?.changed_paths),
      prBodyMarker: stringValue(requireWhen?.pr_body_marker)
    }
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
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
