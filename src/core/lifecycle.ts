import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readYamlFile, writeYamlFile } from "./artifacts.js";

export interface FinalizeOptions {
  workspace: string;
  issueRef?: string;
  prRef?: string;
  releaseRef?: string;
  npmRef?: string;
  status?: string;
  workId?: string;
  finalEvidenceBundleRef?: string;
  verifyExternal?: boolean;
  verifyExternalMode?: "public" | "authenticated";
  expectedCommit?: string;
  tagRefs?: string[];
  force?: boolean;
}

export interface CloseWorkOptions {
  workspace: string;
  workId?: string;
  archive?: boolean;
  force?: boolean;
}

export interface LifecycleResult {
  currentPath: string;
  archivePath?: string;
  evidencePath?: string;
  issuePath?: string;
  archivedFiles?: string[];
  postMergeEvidence?: Record<string, unknown>[];
}

const activeArtifactFiles = [
  ".kc/issue.yaml",
  ".kc/plan.yaml",
  ".kc/approval.yaml",
  ".kc/evidence_bundle.yaml",
  ".kc/agent_envelope.yaml",
  ".kc/change_request.yaml"
];

export function finalizeWork(options: FinalizeOptions): LifecycleResult {
  const workspace = path.resolve(options.workspace);
  const kcDir = path.join(workspace, ".kc");
  const evidencePath = path.join(kcDir, "evidence_bundle.yaml");
  const issuePath = path.join(kcDir, "issue.yaml");
  const evidence = unwrap("approval_evidence_bundle", readYamlFile(evidencePath) ?? {});
  const issue = unwrap("issue_packet", readYamlFile(issuePath) ?? {});
  const status = options.status ?? "completed";
  const workId = sanitizeFileName(options.workId || stringValue(evidence.bundle_id) || "KC-WORK");
  const archiveRef = options.finalEvidenceBundleRef || `.kc/archive/${workId}.final.yaml`;
  const archivePath = path.join(workspace, archiveRef);
  if (fs.existsSync(archivePath) && !options.force) {
    throw new Error(`${archiveRef} already exists. Use --force to overwrite.`);
  }

  const originalDecision = recordValue(evidence.decision) ?? {};
  const requiredActions = stringArray(originalDecision.required_actions);
  const postMergeEvidence = buildPostMergeEvidence(options);
  if (options.verifyExternal) {
    postMergeEvidence.push(...verifyReleaseEvidence({ ...options, workspace, verifyExternalMode: options.verifyExternalMode ?? "public" }));
  }

  const finalizedEvidence: Record<string, unknown> = {
    ...evidence,
    lifecycle_state: "finalized",
    pr_ref: options.prRef || evidence.pr_ref,
    release_ref: options.releaseRef || evidence.release_ref,
    npm_ref: options.npmRef || evidence.npm_ref,
    final_status: status,
    final_evidence_bundle_ref: archiveRef,
    completed_actions: uniqueStrings([...stringArray(evidence.completed_actions), ...requiredActions]),
    post_merge_evidence: uniqueEvidence([...arrayRecords(evidence.post_merge_evidence), ...postMergeEvidence]),
    decision: {
      ...originalDecision,
      status,
      primary_reason: status === "completed" ? "work_completed" : stringValue(originalDecision.primary_reason),
      required_actions: []
    }
  };

  writeYamlFile(evidencePath, { approval_evidence_bundle: finalizedEvidence });
  writeYamlFile(archivePath, { approval_evidence_bundle: finalizedEvidence });

  const finalizedIssue = {
    ...issue,
    issue_ref: options.issueRef || issue.issue_ref,
    issue_state: status === "completed" ? "closed" : issue.issue_state,
    final_status: status,
    final_pr_ref: options.prRef || issue.final_pr_ref,
    final_release_ref: options.releaseRef || issue.final_release_ref
  };
  writeYamlFile(issuePath, { issue_packet: finalizedIssue });

  const current = buildCurrentState({
    lifecycleState: "finalized",
    activeWork: false,
    workId,
    issueRef: options.issueRef || stringValue(finalizedEvidence.issue_ref) || stringValue(finalizedIssue.issue_ref),
    planRef: stringValue(finalizedEvidence.plan_ref),
    approvalRef: stringValue(finalizedEvidence.approval_ref),
    prRef: options.prRef || stringValue(finalizedEvidence.pr_ref),
    releaseRef: options.releaseRef || stringValue(finalizedEvidence.release_ref),
    npmRef: options.npmRef || stringValue(finalizedEvidence.npm_ref),
    finalStatus: status,
    finalEvidenceBundleRef: archiveRef,
    nextAction: "none"
  });
  const currentPath = path.join(kcDir, "current.yaml");
  writeYamlFile(currentPath, { kc_current: current });

  return { currentPath, archivePath, evidencePath, issuePath, postMergeEvidence };
}

export function closeWork(options: CloseWorkOptions): LifecycleResult {
  const workspace = path.resolve(options.workspace);
  const kcDir = path.join(workspace, ".kc");
  const currentPath = path.join(kcDir, "current.yaml");
  const current = unwrap("kc_current", readYamlFile(currentPath) ?? {});
  const evidence = unwrap("approval_evidence_bundle", readYamlFile(path.join(kcDir, "evidence_bundle.yaml")) ?? {});
  const workId = sanitizeFileName(options.workId || stringValue(current.work_id) || stringValue(evidence.bundle_id) || "KC-WORK");
  const archivedFiles: string[] = [];

  if (options.archive !== false) {
    const archiveDir = path.join(kcDir, "archive", workId);
    if (fs.existsSync(archiveDir) && !options.force) {
      throw new Error(`.kc/archive/${workId} already exists. Use --force to overwrite.`);
    }
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const relative of activeArtifactFiles) {
      const source = path.join(workspace, relative);
      if (!fs.existsSync(source)) {
        continue;
      }
      const destination = path.join(archiveDir, path.basename(relative));
      fs.copyFileSync(source, destination);
      archivedFiles.push(path.relative(workspace, destination).replaceAll("\\", "/"));
    }
  }

  const updatedCurrent = {
    ...current,
    lifecycle_state: "archived",
    active_work: false,
    work_id: workId,
    final_status: stringValue(current.final_status) || stringValue(evidence.final_status) || "completed",
    archived_artifacts: archivedFiles,
    next_action: "none",
    updated_at: new Date().toISOString()
  };
  writeYamlFile(currentPath, { kc_current: updatedCurrent });

  return { currentPath, archivedFiles };
}

function buildCurrentState(input: {
  lifecycleState: string;
  activeWork: boolean;
  workId: string;
  issueRef: string;
  planRef: string;
  approvalRef: string;
  prRef: string;
  releaseRef: string;
  npmRef: string;
  finalStatus: string;
  finalEvidenceBundleRef: string;
  nextAction: string;
}): Record<string, unknown> {
  return {
    lifecycle_state: input.lifecycleState,
    active_work: input.activeWork,
    work_id: input.workId,
    issue_ref: input.issueRef,
    plan_ref: input.planRef,
    approval_ref: input.approvalRef,
    pr_ref: input.prRef,
    release_ref: input.releaseRef,
    npm_ref: input.npmRef,
    final_status: input.finalStatus,
    final_evidence_bundle_ref: input.finalEvidenceBundleRef,
    next_action: input.nextAction,
    updated_at: new Date().toISOString()
  };
}

function buildPostMergeEvidence(options: FinalizeOptions): Record<string, unknown>[] {
  const evidence: Record<string, unknown>[] = [];
  if (options.prRef) {
    evidence.push({ type: "github_pr", ref: options.prRef, status: "recorded" });
  }
  if (options.issueRef) {
    evidence.push({ type: "github_issue", ref: options.issueRef, status: "recorded" });
  }
  if (options.releaseRef) {
    evidence.push({ type: "github_release", ref: options.releaseRef, status: "recorded" });
  }
  if (options.npmRef) {
    evidence.push({ type: "npm_package", ref: options.npmRef, status: "recorded" });
  }
  for (const tag of options.tagRefs ?? []) {
    evidence.push({ type: "git_tag", ref: tag, status: "recorded" });
  }
  return evidence;
}

function verifyReleaseEvidence(options: FinalizeOptions & { workspace: string; verifyExternalMode: "public" | "authenticated" }): Record<string, unknown>[] {
  const evidence: Record<string, unknown>[] = [];
  const issueNumber = extractNumber(options.issueRef, /(?:issues\/|issues:|#)(\d+)/);
  if (issueNumber) {
    const result = run("gh", ["issue", "view", issueNumber, "--json", "state,url"], options.workspace, options.verifyExternalMode);
    evidence.push({ type: "github_issue", ref: options.issueRef, status: result.ok && result.stdout.includes("\"CLOSED\"") ? "passed" : "unverified", expected_status: "closed", detail: result.detail, verification_mode: options.verifyExternalMode });
  }

  const prNumber = extractNumber(options.prRef, /(?:pull\/|pulls\/|pr\/|#)(\d+)/);
  if (prNumber) {
    const result = run("gh", ["pr", "view", prNumber, "--json", "state,mergeCommit,url"], options.workspace, options.verifyExternalMode);
    evidence.push({ type: "github_pr", ref: options.prRef, status: result.ok && result.stdout.includes("\"MERGED\"") ? "passed" : "unverified", expected_status: "merged", detail: result.detail, verification_mode: options.verifyExternalMode });
  }

  const releaseTag = extractReleaseTag(options.releaseRef);
  if (releaseTag) {
    const result = run("gh", ["release", "view", releaseTag, "--json", "tagName,isDraft,url"], options.workspace, options.verifyExternalMode);
    evidence.push({ type: "github_release", ref: options.releaseRef, status: result.ok && result.stdout.includes("\"isDraft\":false") ? "passed" : "unverified", expected_status: "published", detail: result.detail, verification_mode: options.verifyExternalMode });
  }

  for (const tag of options.tagRefs ?? []) {
    const result = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], options.workspace, options.verifyExternalMode);
    const matchesCommit = options.expectedCommit ? result.stdout.includes(options.expectedCommit) : result.stdout.trim().length > 0;
    evidence.push({ type: "git_tag", ref: tag, status: result.ok && matchesCommit ? "passed" : "unverified", detail: result.detail, verification_mode: options.verifyExternalMode });
  }

  const npmPackage = parseNpmPackage(options.npmRef);
  if (npmPackage) {
    const result = run(process.platform === "win32" ? "npm.cmd" : "npm", ["view", npmPackage.name, "version"], options.workspace, options.verifyExternalMode);
    evidence.push({ type: "npm_package", ref: options.npmRef, status: result.ok && result.stdout.trim() === npmPackage.version ? "passed" : "unverified", detail: result.detail, verification_mode: options.verifyExternalMode });
  }
  return evidence;
}

function run(command: string, args: string[], cwd: string, verifyExternalMode: "public" | "authenticated"): { ok: boolean; stdout: string; detail: string } {
  const env = { ...process.env };
  if (verifyExternalMode === "public") {
    delete env.GITHUB_TOKEN;
  }
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    ok: result.status === 0,
    stdout,
    detail: result.status === 0 ? stdout.trim() : stderr.trim() || `exit ${String(result.status)}`
  };
}

function unwrap(root: string, data: Record<string, unknown>): Record<string, unknown> {
  const value = data[root];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return data;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueEvidence(values: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${String(item.type ?? "")}:${String(item.ref ?? "")}:${String(item.status ?? "")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "KC-WORK";
}

function extractNumber(value: string | undefined, pattern: RegExp): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.match(pattern)?.[1];
}

function extractReleaseTag(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.split("/releases/tag/").at(1) ?? value.match(/tag:([^/]+)$/)?.[1] ?? value.match(/releases\/tag\/([^/]+)/)?.[1];
}

function parseNpmPackage(value: string | undefined): { name: string; version: string } | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) {
    return undefined;
  }
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) };
}
