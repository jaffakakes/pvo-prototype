import { parseTaskRecord, TASK_LIMITS } from "../tasks/index.js";
import { parseServiceDraft } from "../services/index.js";
import { object, id, integer, text, requireTask } from "../tasks/validation.js";

/** A saved draft receipt is separate from component changes and grants no publish authority. */
export function parseDraftTaskResult(value) {
  object(
    value,
    [
      "kind",
      "ownerId",
      "projectId",
      "taskId",
      "baseFingerprint",
      "serviceId",
      "revision",
    ],
    "Saved draft result",
  );
  requireTask(value.kind === "container_draft", "Unsupported draft result.");
  for (const key of ["ownerId", "projectId", "taskId", "serviceId"])
    id(value[key], key);
  text(
    value.baseFingerprint,
    TASK_LIMITS.fingerprintBytes,
    "Starting draft fingerprint",
  );
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Saved draft revision");
  return structuredClone(value);
}
export function prepareDraftTaskResult(task, draft) {
  task = parseTaskRecord(task);
  draft = parseServiceDraft(draft);
  requireTask(
    task.input.context.container?.serviceId === draft.identity.serviceId &&
      task.ownerId === draft.identity.ownerId &&
      task.input.projectId === draft.identity.projectId,
    "Draft result does not belong to this task.",
  );
  return parseDraftTaskResult({
    kind: "container_draft",
    ownerId: task.ownerId,
    projectId: task.input.projectId,
    taskId: task.id,
    baseFingerprint: task.input.context.fingerprint,
    serviceId: draft.identity.serviceId,
    revision: draft.revision,
  });
}
export function matchDraftTaskResult(value, task) {
  const result = parseDraftTaskResult(value);
  task = parseTaskRecord(task);
  requireTask(
    result.ownerId === task.ownerId &&
      result.projectId === task.input.projectId &&
      result.taskId === task.id &&
      result.baseFingerprint === task.input.context.fingerprint &&
      result.serviceId === task.input.context.container?.serviceId,
    "Saved draft result does not belong to this task.",
  );
  return result;
}
