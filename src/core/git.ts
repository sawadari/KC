import { execFileSync } from "node:child_process";
import { uniquePaths } from "./path-match.js";

export function detectChangedFiles(workspace: string): string[] {
  const attempts: string[][] = [
    ["diff", "--name-only", "origin/main...HEAD"],
    ["diff", "--name-only", "main...HEAD"],
    ["diff", "--name-only", "--cached"],
    ["diff", "--name-only"]
  ];

  for (const args of attempts) {
    try {
      const output = execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const files = uniquePaths(output.split(/\r?\n/));
      if (files.length > 0) {
        return files;
      }
    } catch {
      // Try the next strategy. New repositories often have no origin or main ref yet.
    }
  }

  return [];
}

