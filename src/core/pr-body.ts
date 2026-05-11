import type { Finding } from "./types.js";

const requiredSections = ["Linked Issue", "Approved Plan", "Approval", "Verification", "Validation", "KC Evidence"];

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
