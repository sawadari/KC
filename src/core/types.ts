export type KcDecision = "PASS" | "WARN" | "HOLD" | "FAIL";

export type FindingSeverity = "info" | "warning" | "error";

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  reasonCode: string;
  message: string;
  path?: string;
}

export interface CheckOptions {
  workspace: string;
  rulesetPath?: string;
  changedFiles?: string[];
  prRef?: string;
}

export interface CheckResult {
  decision: KcDecision;
  mergeReady: boolean;
  primaryReason: string;
  findings: Finding[];
  changedFiles: string[];
  evidenceBundlePath: string;
  evidenceBundle: Record<string, unknown>;
}

export interface LoadedArtifacts {
  issue?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  approval?: Record<string, unknown>;
  envelope?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  ruleset?: Record<string, unknown>;
  loadFindings: Finding[];
}

