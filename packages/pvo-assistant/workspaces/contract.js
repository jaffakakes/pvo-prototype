import {
  digest,
  id,
  integer,
  object,
  requireTask,
} from "../tasks/validation.js";
import { TASK_LIMITS } from "../tasks/index.js";
import { parseServiceFiles } from "../services/index.js";

export const WORKSPACE_LIMITS = Object.freeze({
  operations: TASK_LIMITS.operations,
  reservationMs: 24 * 60 * 60_000,
  retentionMs: TASK_LIMITS.retentionMs,
  sessionMs: 120_000,
  commandMs: 15_000,
  startupMs: 20_000,
  outputBytes: 16 * 1024,
  concurrent: 2,
  dailySessions: 12,
  cleanupAttempts: 5,
});

export function parseWorkspaceIdentity(value) {
  object(
    value,
    ["resourceId", "ownerId", "projectId", "taskId"],
    "Workspace identity",
  );
  for (const name of ["ownerId", "projectId", "taskId"])
    id(value[name], "Workspace owner/task ID");
  requireTask(
    typeof value.resourceId === "string" &&
      /^workspace-[a-f0-9]{64}$/.test(value.resourceId),
    "Workspace resource identity is invalid.",
  );
  return structuredClone(value);
}

export const serializeWorkspaceIdentity = (value) => {
  const identity = parseWorkspaceIdentity(value);
  return JSON.stringify([
    identity.resourceId,
    identity.ownerId,
    identity.projectId,
    identity.taskId,
  ]);
};

export function parseWorkspaceSnapshot(value) {
  object(value, ["revision", "digest", "files"], "Workspace source snapshot");
  integer(
    value.revision,
    WORKSPACE_LIMITS.operations,
    "Workspace source revision",
    1,
  );
  digest(value.digest, "Workspace source digest");
  return {
    revision: value.revision,
    digest: value.digest,
    files: parseServiceFiles(value.files),
  };
}
