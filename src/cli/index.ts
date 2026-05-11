#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runAssist, defaultModel } from "../core/assist.js";
import { runCheck } from "../core/check.js";
import { initWorkspace } from "../core/templates.js";

interface ParsedArgs {
  command: string;
  values: Map<string, string[]>;
  positionals: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "help" || args.values.has("help")) {
    printHelp();
    return;
  }

  if (args.command === "init") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const result = initWorkspace({ workspace, force: args.values.has("force") });
    console.log(`KC init complete: ${result.created.length} created, ${result.skipped.length} skipped.`);
    for (const file of result.created) {
      console.log(`created ${file}`);
    }
    for (const file of result.skipped) {
      console.log(`skipped ${file}`);
    }
    return;
  }

  if (args.command === "check" || args.command === "bundle") {
    const workspace = value(args, "workspace") || value(args, "w") || ".";
    const changedFiles = await readChangedFiles(args);
    const result = await runCheck({
      workspace,
      rulesetPath: value(args, "ruleset") || ".kc/ruleset.yaml",
      changedFiles,
      prRef: value(args, "pr-ref")
    });
    printCheckResult(result, args.values.has("json"));
    if (args.command === "check" && (result.decision === "HOLD" || result.decision === "FAIL")) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.command === "assist") {
    const input = await readAssistInput(args);
    const result = await runAssist({
      apiKey: value(args, "openai-api-key") || process.env.OPENAI_API_KEY,
      model: value(args, "model") || defaultModel,
      kind: parseAssistKind(value(args, "kind") || "issue-questions"),
      input
    });
    console.log(`# KC AI Assist Candidate${result.model ? ` (${result.model})` : ""}`);
    console.log("");
    console.log(result.output);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

function parseAssistKind(kind: string): "issue-questions" | "plan-draft" | "bundle-draft" | "pr-summary" {
  if (kind === "issue-questions" || kind === "plan-draft" || kind === "bundle-draft" || kind === "pr-summary") {
    return kind;
  }
  throw new Error(`Invalid assist kind: ${kind}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const values = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const [key, inlineValue] = withoutPrefix.split("=", 2);
    if (inlineValue !== undefined) {
      push(values, key, inlineValue);
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      push(values, key, next);
      index += 1;
    } else {
      push(values, key, "true");
    }
  }

  return { command, values, positionals };
}

function push(values: Map<string, string[]>, key: string, item: string): void {
  const current = values.get(key) ?? [];
  current.push(item);
  values.set(key, current);
}

function value(args: ParsedArgs, key: string): string | undefined {
  return args.values.get(key)?.at(-1);
}

async function readChangedFiles(args: ParsedArgs): Promise<string[] | undefined> {
  const inline = args.values.get("changed-file") ?? [];
  const filePath = value(args, "changed-files");
  if (!filePath) {
    return inline.length > 0 ? inline : undefined;
  }
  const content = fs.readFileSync(path.resolve(filePath), "utf8");
  return [...inline, ...content.split(/\r?\n/).filter(Boolean)];
}

async function readAssistInput(args: ParsedArgs): Promise<string> {
  const inputFile = value(args, "input");
  if (inputFile) {
    return fs.readFileSync(path.resolve(inputFile), "utf8");
  }
  if (args.positionals.length > 0) {
    return args.positionals.join(" ");
  }
  return await readStdin();
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printCheckResult(result: Awaited<ReturnType<typeof runCheck>>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`KC PR Check: ${result.decision}`);
  console.log(`merge_ready: ${result.mergeReady}`);
  console.log(`primary_reason: ${result.primaryReason}`);
  console.log(`evidence_bundle: ${result.evidenceBundlePath}`);
  if (result.changedFiles.length > 0) {
    console.log("");
    console.log("Changed files:");
    for (const file of result.changedFiles) {
      console.log(`- ${file}`);
    }
  }
  if (result.findings.length > 0) {
    console.log("");
    console.log("Findings:");
    for (const finding of result.findings) {
      const location = finding.path ? ` (${finding.path})` : "";
      console.log(`- [${finding.severity}] ${finding.ruleId} ${finding.reasonCode}${location}: ${finding.message}`);
    }
  }
}

function printHelp(): void {
  console.log(`kc - Knowledge Convergence guard for Codex + GitHub

Usage:
  kc init [--workspace .] [--force]
  kc check [--workspace .] [--changed-files files.txt] [--changed-file path] [--json]
  kc bundle [--workspace .] [--changed-files files.txt]
  kc assist [--kind issue-questions|plan-draft|bundle-draft|pr-summary] [--input file] [--model gpt-5.5]

AI assist uses OPENAI_API_KEY or --openai-api-key. Deterministic checks do not require API credentials.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
