import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Finding, LoadedArtifacts } from "./types.js";

const artifactFiles = {
  issue: ".kc/issue.yaml",
  plan: ".kc/plan.yaml",
  approval: ".kc/approval.yaml",
  envelope: ".kc/agent_envelope.yaml",
  evidence: ".kc/evidence_bundle.yaml"
} as const;

export function readYamlFile(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = YAML.parse(content);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export function loadArtifacts(workspace: string, rulesetPath?: string): LoadedArtifacts {
  const loadFindings: Finding[] = [];
  const loaded: LoadedArtifacts = { loadFindings };

  for (const [key, relativePath] of Object.entries(artifactFiles)) {
    const absolutePath = path.join(workspace, relativePath);
    try {
      const data = readYamlFile(absolutePath);
      if (data) {
        const unwrapped = unwrapRoot(key, data);
        if (key === "issue") {
          loaded.issue = unwrapped;
        } else if (key === "plan") {
          loaded.plan = unwrapped;
        } else if (key === "approval") {
          loaded.approval = unwrapped;
        } else if (key === "envelope") {
          loaded.envelope = unwrapped;
        } else if (key === "evidence") {
          loaded.evidence = unwrapped;
        }
      }
    } catch (error) {
      loadFindings.push({
        ruleId: "KC-AE-000",
        severity: "error",
        reasonCode: "invalid_yaml",
        path: relativePath,
        message: `${relativePath} could not be parsed: ${String((error as Error).message ?? error)}`
      });
    }
  }

  if (rulesetPath) {
    const absoluteRuleset = path.isAbsolute(rulesetPath) ? rulesetPath : path.join(workspace, rulesetPath);
    try {
      loaded.ruleset = readYamlFile(absoluteRuleset);
    } catch (error) {
      loadFindings.push({
        ruleId: "KC-AE-000",
        severity: "warning",
        reasonCode: "invalid_ruleset",
        path: rulesetPath,
        message: `${rulesetPath} could not be parsed: ${String((error as Error).message ?? error)}`
      });
    }
  }

  return loaded;
}

function unwrapRoot(kind: string, data: Record<string, unknown>): Record<string, unknown> {
  const roots: Record<string, string> = {
    issue: "issue_packet",
    plan: "agent_plan",
    approval: "plan_approval",
    envelope: "agent_execution_envelope",
    evidence: "approval_evidence_bundle"
  };
  const root = roots[kind];
  const maybeWrapped = root ? data[root] : undefined;
  if (maybeWrapped && typeof maybeWrapped === "object" && !Array.isArray(maybeWrapped)) {
    return maybeWrapped as Record<string, unknown>;
  }
  return data;
}

export function writeYamlFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}
