import YAML from "yaml";

export const defaultModel = "gpt-5.5";

export type AssistKind =
  | "issue-packet"
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
    "plan-draft": "plan",
    "bundle-draft": "evidence-bundle",
    "evidence": "evidence-bundle",
    "ledger": "decision-ledger"
  };
  const normalized = aliases[kind] ?? kind;
  if (
    normalized === "issue-packet" ||
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

function validateStructuredOutput(kind: AssistKind, output: string): string {
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
  const serialized = JSON.stringify(value).toLowerCase();
  if (serialized.includes("approved_with_conditions") || serialized.includes("validation_status\":\"passed") || serialized.includes("merge_ready\":true")) {
    throw new Error("AI assist output attempted to claim approval, validation passed, or merge readiness.");
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

