import fs from "node:fs";
import path from "node:path";
import { writeYamlFile } from "./artifacts.js";

export interface ChangeRequestRecordOptions {
  workspace: string;
  changeRequestId?: string;
  targetPlanId: string;
  reason: string;
  requestedScopeAddition: string[];
  status?: string;
  force?: boolean;
}

export function recordChangeRequest(options: ChangeRequestRecordOptions): string {
  const workspace = path.resolve(options.workspace);
  const requestPath = path.join(workspace, ".kc", "change_request.yaml");
  if (fs.existsSync(requestPath) && !options.force) {
    throw new Error(`${requestPath} already exists. Pass --force to overwrite.`);
  }

  writeYamlFile(requestPath, {
    plan_change_request: {
      change_request_id: options.changeRequestId || "PCR-001",
      target_plan_id: options.targetPlanId,
      reason: options.reason,
      requested_scope_addition: options.requestedScopeAddition,
      status: options.status || "pending_approval"
    }
  });
  return requestPath;
}
