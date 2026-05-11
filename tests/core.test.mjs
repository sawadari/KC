import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runCheck } from "../lib/core/check.js";
import { initWorkspace } from "../lib/core/templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "tests", "fixtures");

describe("KC rule engine", () => {
  it("returns PASS for a fully evidenced approved change", async () => {
    const workspace = path.join(fixtures, "pass");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "PASS");
    assert.equal(result.mergeReady, true);
    assert.equal(result.primaryReason, "none");
  });

  it("returns WARN when validation scenario is explicitly pending", async () => {
    const workspace = path.join(fixtures, "warn");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "WARN");
    assert.equal(result.mergeReady, true);
    assert.equal(result.primaryReason, "validation_pending");
  });

  it("returns HOLD for out-of-scope or prohibited changes", async () => {
    const workspace = path.join(fixtures, "hold");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "HOLD");
    assert.equal(result.mergeReady, false);
    assert.equal(result.primaryReason, "scope_violation");
    assert.ok(result.findings.some((finding) => finding.reasonCode === "prohibited_file_changed"));
  });

  it("returns FAIL when validation is marked passed without validation evidence", async () => {
    const workspace = path.join(fixtures, "fail");
    const result = await runCheck({
      workspace,
      changedFiles: readChangedFiles(workspace)
    });

    assert.equal(result.decision, "FAIL");
    assert.equal(result.mergeReady, false);
    assert.equal(result.primaryReason, "validation_inferred_from_verification");
  });
});

describe("KC CLI", () => {
  it("runs check successfully for PASS fixtures", () => {
    const workspace = path.join(fixtures, "pass");
    const result = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "check",
      "--workspace",
      workspace,
      "--changed-files",
      path.join(workspace, "changed-files.txt")
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /KC PR Check: PASS/);
  });

  it("exits non-zero for HOLD fixtures", () => {
    const workspace = path.join(fixtures, "hold");
    const result = spawnSync(process.execPath, [
      path.join(root, "lib", "cli", "index.js"),
      "check",
      "--workspace",
      workspace,
      "--changed-files",
      path.join(workspace, "changed-files.txt")
    ], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /KC PR Check: HOLD/);
  });
});

describe("workspace init and action build", () => {
  it("copies templates without overwriting existing files", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kc-init-"));
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "existing", "utf8");

    const result = initWorkspace({ workspace });

    assert.ok(result.skipped.includes("AGENTS.md"));
    assert.equal(fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf8"), "existing");
    assert.ok(fs.existsSync(path.join(workspace, ".kc", "plan.example.yaml")));
  });

  it("builds the GitHub Action bundle", () => {
    assert.ok(fs.existsSync(path.join(root, "dist", "action", "index.js")));
  });
});

function readChangedFiles(workspace) {
  return fs.readFileSync(path.join(workspace, "changed-files.txt"), "utf8").split(/\r?\n/).filter(Boolean);
}

