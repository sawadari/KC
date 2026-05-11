export const defaultModel = "gpt-5.5";

export interface AssistOptions {
  apiKey?: string;
  model?: string;
  kind: "issue-questions" | "plan-draft" | "bundle-draft" | "pr-summary";
  input: string;
}

export interface AssistResult {
  skipped: boolean;
  model?: string;
  output: string;
}

export async function runAssist(options: AssistOptions): Promise<AssistResult> {
  if (!options.apiKey) {
    return {
      skipped: true,
      output: "AI assist skipped: OPENAI_API_KEY or --openai-api-key is not configured."
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
          content: "You draft Knowledge Convergence artifacts. Output candidates only. Never claim approval, validation passed, or deterministic gate status."
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
  return {
    skipped: false,
    model,
    output: extractOutputText(json)
  };
}

function buildPrompt(kind: AssistOptions["kind"], input: string): string {
  const header = {
    "issue-questions": "Draft missing-information questions for this GitHub Issue.",
    "plan-draft": "Draft a .kc/plan.yaml candidate from this issue or plan text.",
    "bundle-draft": "Draft an approval evidence bundle candidate from this check context.",
    "pr-summary": "Draft a concise PR comment explaining the KC Guard result."
  }[kind];

  return `${header}\n\nMark all output as candidate/draft. Preserve verification and validation as separate concepts.\n\nInput:\n${input}`;
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

