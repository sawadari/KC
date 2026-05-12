import YAML from "yaml";

export const defaultModel = "gpt-5.5";

export type AssistKind =
  | "issue-packet"
  | "nrvv-candidate"
  | "plan"
  | "evidence-bundle"
  | "decision-ledger"
  | "pr-summary";

export interface AssistOptions {
  apiKey?: string;
  model?: string;
  kind: AssistKind;
  input: string;
  offlineTemplate?: boolean;
}

export interface AssistResult {
  skipped: boolean;
  model?: string;
  output: string;
  structured: boolean;
}

export function normalizeAssistKind(kind: string): AssistKind {
  const aliases: Record<string, AssistKind> = {
    "issue-questions": "issue-packet",
    "issue-draft": "issue-packet",
    "nrvv": "nrvv-candidate",
    "nrvv-draft": "nrvv-candidate",
    "plan-draft": "plan",
    "bundle-draft": "evidence-bundle",
    "evidence": "evidence-bundle",
    "ledger": "decision-ledger"
  };
  const normalized = aliases[kind] ?? kind;
  if (
    normalized === "issue-packet" ||
    normalized === "nrvv-candidate" ||
    normalized === "plan" ||
    normalized === "evidence-bundle" ||
    normalized === "decision-ledger" ||
    normalized === "pr-summary"
  ) {
    return normalized;
  }
  throw new Error(`Invalid assist kind: ${kind}`);
}

export async function runAssist(options: AssistOptions): Promise<AssistResult> {
  if (options.offlineTemplate) {
    return {
      skipped: false,
      output: structuredTemplate(options.kind, options.input),
      structured: options.kind !== "pr-summary"
    };
  }

  if (!options.apiKey) {
    return {
      skipped: true,
      output: "AI assist skipped: OPENAI_API_KEY or --openai-api-key is not configured.",
      structured: false
    };
  }

  const model = options.model || defaultModel;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: systemPrompt()
        },
        {
          role: "user",
          content: buildPrompt(options.kind, options.input)
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Responses API returned ${response.status}: ${body}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const output = extractOutputText(json);
  return {
    skipped: false,
    model,
    output: validateStructuredOutput(options.kind, output),
    structured: options.kind !== "pr-summary"
  };
}

export function systemPrompt(): string {
  return [
    "You draft Knowledge Convergence artifacts.",
    "Output candidates only.",
    "Never claim approval, validation passed, merge readiness, or deterministic gate status.",
    "Set candidate_status to draft for YAML artifacts.",
    "Use validation_status: pending unless the user supplies an explicit validation report reference.",
    "Preserve verification and validation as separate concepts."
  ].join(" ");
}

function buildPrompt(kind: AssistKind, input: string): string {
  const header = {
    "issue-packet": "Draft a parseable .kc/issue.yaml candidate.",
    "nrvv-candidate": "Draft a parseable NRVV candidate for missing or incomplete Issue fields.",
    plan: "Draft a parseable .kc/plan.yaml candidate with status pending_approval.",
    "evidence-bundle": "Draft a parseable .kc/evidence_bundle.yaml candidate with no passed validation unless evidence is explicit.",
    "decision-ledger": "Draft a DecisionLedger candidate in Markdown with source references.",
    "pr-summary": "Draft a concise PR comment explaining the KC Guard result."
  }[kind];

  const format = kind === "decision-ledger" || kind === "pr-summary" ? "Markdown" : "YAML only, no code fences";
  return `${header}\n\nFormat: ${format}.\nMark all output as candidate/draft.\n\nInput:\n${input}`;
}

function structuredTemplate(kind: AssistKind, input: string): string {
  const sourceSummary = input.trim().slice(0, 500);
  if (kind === "issue-packet") {
    return YAML.stringify({
      issue_packet: {
        candidate_status: "draft",
        issue_ref: "candidate:unlinked",
        problem_statement: sourceSummary || "TBD",
        expected_outcome: "TBD",
        acceptance_criteria: ["TBD"],
        validation_status: "pending",
        risk_tier: "medium",
        non_goals: ["TBD"],
        issue_state: "draft"
      }
    });
  }
  if (kind === "nrvv-candidate") {
    return YAML.stringify({
      nrvv_candidate: {
        candidate_status: "draft",
        source_summary: sourceSummary || "TBD",
        proposed_nrvv: {
          need: {
            need_id: "NEED-1",
            stakeholder: "TBD",
            situation: sourceSummary || "TBD",
            pain_or_risk: "TBD",
            desired_operational_outcome: "TBD"
          },
          requirements: [
            {
              requirement_id: "REQ-1",
              statement: "TBD",
              source_need_ref: "NEED-1",
              risk_tier: "medium"
            }
          ],
          verification: [
            {
              requirement_ref: "REQ-1",
              method: "TBD",
              success_criteria: "TBD",
              evidence_expected: "TBD"
            }
          ],
          validation: {
            validation_scenario_id: "VAL-1",
            scenario: "TBD",
            intended_environment: "TBD",
            success_criteria: ["TBD"],
            evidence_expected: ["validation report"],
            validation_status: "pending"
          },
          gaps: {
            verification_to_validation_gap: [
              "Verification evidence does not automatically prove the original Need is satisfied."
            ]
          }
        },
        missing_field_questions: [
          "Who has the Need?",
          "What operational outcome should improve?",
          "Which Requirements must be verified?",
          "What Validation scenario proves the Need is satisfied?"
        ],
        safety: {
          human_review_required: true,
          deterministic_decision_unchanged: true
        }
      }
    });
  }
  if (kind === "plan") {
    return YAML.stringify({
      agent_plan: {
        candidate_status: "draft",
        plan_id: "PLAN-DRAFT",
        issue_ref: "candidate:unlinked",
        interpreted_requirement: sourceSummary || "TBD",
        scope: { allowed_files: ["TBD"], prohibited_files: ["TBD"] },
        non_goals: ["TBD"],
        plan_items: [{ id: "P1", action: "TBD", expected_files: ["TBD"] }],
        verification_plan: ["TBD"],
        validation_evidence_plan: ["TBD"],
        questions_for_human: [],
        status: "pending_approval"
      }
    });
  }
  if (kind === "evidence-bundle") {
    return YAML.stringify({
      approval_evidence_bundle: {
        candidate_status: "draft",
        bundle_id: "AEB-DRAFT",
        issue_ref: "candidate:unlinked",
        plan_ref: "PLAN-DRAFT",
        approval_ref: "pending",
        pr_ref: "pending",
        diff_summary: { changed_files: [], out_of_scope_files: [] },
        verification_evidence: [],
        validation_evidence: [],
        validation_status: "pending",
        findings: [],
        decision: { branch: "hold", primary_reason: "candidate_not_reviewed", required_actions: ["Human review required."] }
      }
    });
  }
  if (kind === "decision-ledger") {
    return [
      "# DecisionLedger Candidate",
      "",
      "candidate_status: draft",
      "",
      "## Source",
      "",
      sourceSummary || "TBD",
      "",
      "## Candidate Decision",
      "",
      "- decision: pending",
      "- rationale: TBD",
      "- validation_status: pending",
      "- human_review_required: true"
    ].join("\n");
  }
  return [
    "## KC Guard Candidate Summary",
    "",
    "candidate_status: draft",
    "",
    sourceSummary || "No input provided.",
    "",
    "This candidate does not change the deterministic KC decision."
  ].join("\n");
}

export function validateStructuredOutput(kind: AssistKind, output: string): string {
  if (kind === "decision-ledger" || kind === "pr-summary") {
    return output;
  }

  const yamlText = stripCodeFence(output);
  const parsed = YAML.parse(yamlText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`AI assist produced non-object YAML for ${kind}.`);
  }
  ensureDraftOnly(parsed as Record<string, unknown>);
  return YAML.stringify(parsed);
}

function ensureDraftOnly(value: Record<string, unknown>): void {
  const violations: string[] = [];
  collectAuthorityViolations(value, [], violations);
  if (violations.length > 0) {
    throw new Error(`AI assist output attempted to claim approval, validation passed, merge readiness, or execution authority: ${violations.join(", ")}.`);
  }
}

function collectAuthorityViolations(value: unknown, path: string[], violations: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAuthorityViolations(item, [...path, String(index)], violations));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = typeof item === "string" ? item.trim().toLowerCase() : item;
    if (normalizedKey === "decision" && (normalizedValue === "approved" || normalizedValue === "approved_with_conditions")) {
      violations.push([...path, key].join("."));
    }
    if (normalizedKey === "status" && (normalizedValue === "approved" || normalizedValue === "approved_with_conditions")) {
      violations.push([...path, key].join("."));
    }
    if (normalizedKey === "validation_status" && normalizedValue === "passed") {
      violations.push([...path, key].join("."));
    }
    if (normalizedKey === "merge_ready" && (item === true || normalizedValue === "true")) {
      violations.push([...path, key].join("."));
    }
    if (normalizedKey === "branch" && normalizedValue === "execute") {
      violations.push([...path, key].join("."));
    }
    collectAuthorityViolations(item, [...path, key], violations);
  }
}

function stripCodeFence(output: string): string {
  const trimmed = output.trim();
  const match = trimmed.match(/^```(?:yaml|yml)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

function extractOutputText(json: Record<string, unknown>): string {
  if (typeof json.output_text === "string") {
    return json.output_text;
  }

  const output = json.output;
  if (!Array.isArray(output)) {
    return JSON.stringify(json, null, 2);
  }

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const text = (contentItem as Record<string, unknown>).text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }

  return chunks.join("\n").trim() || JSON.stringify(json, null, 2);
}

