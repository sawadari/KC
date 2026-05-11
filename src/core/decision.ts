import type { Finding, KcDecision } from "./types.js";

export function decide(findings: Finding[]): KcDecision {
  if (findings.some((finding) => finding.severity === "error" && (finding.ruleId === "KC-AE-000" || finding.ruleId === "KC-AE-008"))) {
    return "FAIL";
  }
  if (findings.some((finding) => finding.severity === "error")) {
    return "HOLD";
  }
  if (findings.some((finding) => finding.severity === "warning")) {
    return "WARN";
  }
  return "PASS";
}

export function primaryReason(findings: Finding[]): string {
  const blocking = findings.find((finding) => finding.severity === "error");
  if (blocking) {
    return blocking.reasonCode;
  }
  const warning = findings.find((finding) => finding.severity === "warning");
  if (warning) {
    return warning.reasonCode;
  }
  return "none";
}

