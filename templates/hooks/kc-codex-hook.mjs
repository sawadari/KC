#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const workspace = process.env.KC_WORKSPACE || process.cwd();
const event = process.env.KC_HOOK_EVENT || process.argv[2] || "";
const payload = await readPayload();
const result = evaluate(event || String(payload.event || payload.hook_event || ""), payload);

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.decision === "block" ? 2 : 0;

function evaluate(eventName, data) {
  const normalizedEvent = eventName.toLowerCase();
  if (normalizedEvent.includes("userpromptsubmit")) {
    return evaluateUserPrompt(data);
  }
  if (normalizedEvent.includes("pretooluse") || normalizedEvent.includes("permissionrequest")) {
    return evaluatePreToolUse(data);
  }
  if (normalizedEvent.includes("stop")) {
    return evaluateStop(data);
  }
  return allow("No KC policy applies to this hook event.");
}

function evaluateUserPrompt(data) {
  const prompt = String(data.prompt || data.user_prompt || data.input || "");
  if (!hasImplementationIntent(prompt)) {
    return allow("Prompt does not request implementation.");
  }
  const approval = readText(".kc/approval.yaml");
  if (!approval || !/decision:\s*approved(_with_conditions)?\b/.test(approval)) {
    return block("Plan approval is missing. Create `.kc/plan.yaml` and obtain `.kc/approval.yaml` approval before implementation.");
  }
  return allow("Approved plan is present.");
}

function evaluatePreToolUse(data) {
  const toolName = String(data.tool_name || data.tool || "");
  const paths = extractPaths(data);
  const edits = paths.length > 0 || /apply_patch|write|edit|bash|shell/i.test(toolName);
  if (!edits) {
    return allow("Tool use does not appear to edit files.");
  }

  const approval = readText(".kc/approval.yaml");
  if (!approval || !/decision:\s*approved(_with_conditions)?\b/.test(approval)) {
    return block("Plan approval is missing. File edits are blocked.");
  }

  const allowed = readYamlList(approval, "approved_scope");
  const plan = readText(".kc/plan.yaml") || "";
  const prohibited = readYamlList(plan, "prohibited_files");
  for (const filePath of paths) {
    if (matchesAny(filePath, prohibited)) {
      return block(`${filePath} matches prohibited_files. Create a Plan Change Request.`);
    }
    if (allowed.length > 0 && !matchesAny(filePath, allowed)) {
      return block(`${filePath} is outside approved_scope. Create a Plan Change Request.`);
    }
  }

  return allow("Tool use is inside approved KC scope.");
}

function evaluateStop(data) {
  const changedFiles = Array.isArray(data.changed_files) ? data.changed_files : [];
  const codeChanged = Boolean(data.code_changed) || changedFiles.some((filePath) => !String(filePath).startsWith(".kc/"));
  if (codeChanged && !fs.existsSync(path.join(workspace, ".kc", "evidence_bundle.yaml"))) {
    return block("Code changed but `.kc/evidence_bundle.yaml` is missing. Generate evidence before finishing.");
  }
  return allow("Stop gate passed.");
}

function hasImplementationIntent(prompt) {
  return /(implement|fix|change|edit|write|build|進め|実装|修正|変更|作って|追加)/i.test(prompt);
}

function extractPaths(value) {
  const paths = new Set();
  visit(value);
  return [...paths].filter((item) => !item.includes("\n")).map((item) => item.replaceAll("\\", "/"));

  function visit(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (/path|file|target/i.test(key) && typeof child === "string") {
        paths.add(child);
      } else {
        visit(child);
      }
    }
  }
}

function readYamlList(text, key) {
  const lines = text.split(/\r?\n/);
  const values = [];
  let inBlock = false;
  let indent = 0;
  for (const line of lines) {
    const keyMatch = line.match(new RegExp(`^(\\s*)${key}:\\s*$`));
    if (keyMatch) {
      inBlock = true;
      indent = keyMatch[1].length;
      continue;
    }
    if (!inBlock) {
      continue;
    }
    const currentIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (line.trim() && currentIndent <= indent) {
      break;
    }
    const valueMatch = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
    if (valueMatch) {
      values.push(valueMatch[1].trim());
    }
  }
  return values;
}

function matchesAny(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function readText(relativePath) {
  const absolutePath = path.join(workspace, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

async function readPayload() {
  if (process.stdin.isTTY) {
    return {};
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { input: text };
  }
}

function allow(reason) {
  return { decision: "allow", reason };
}

function block(reason) {
  return { decision: "block", reason };
}

