import {
  matchServiceAttachment,
  parseServiceAttachmentReceipt,
} from "../attachments/index.js";
import { canonicalJson } from "../services/json.js";
import { parseNativeOperation } from "../native/index.js";
import {
  parseTaskRecord,
  parseTaskReference,
  TASK_LIMITS,
} from "../tasks/index.js";
import { validateArtifact } from "../tasks/content.js";
import {
  boundedJson,
  id,
  list,
  object,
  requireTask,
  text,
} from "../tasks/validation.js";

export const PREPARED_COMPONENT_OPERATIONS = Object.freeze([
  "component.add",
  "component.update",
  "component.content",
  "component.style",
  "component.source",
  "component.delete",
]);

/** An immutable component proposal, never a provider action or executable host command. */
export function parsePreparedTaskResult(value) {
  object(
    value,
    [
      "kind",
      "ownerId",
      "projectId",
      "taskId",
      "baseFingerprint",
      "operations",
      "attachment",
    ],
    "Prepared task result",
  );
  requireTask(
    value.kind === "component_changes",
    "Unsupported prepared result kind.",
  );
  for (const key of ["ownerId", "projectId", "taskId"])
    id(value[key], "Prepared result identity");
  text(
    value.baseFingerprint,
    TASK_LIMITS.fingerprintBytes,
    "Starting project fingerprint",
  );
  list(value.operations, 24, "Prepared component operations");
  requireTask(
    value.operations.length > 0,
    "A prepared result needs component changes.",
  );
  for (const operation of value.operations) {
    parseNativeOperation(operation);
    requireTask(
      PREPARED_COMPONENT_OPERATIONS.includes(operation.kind),
      "Prepared results may only propose component changes.",
    );
  }
  if (value.attachment !== null) {
    object(
      value.attachment,
      ["command", "receipt"],
      "Prepared service attachment",
    );
    const receipt = parseServiceAttachmentReceipt(value.attachment.receipt);
    const { command } = matchServiceAttachment(
      value.attachment.command,
      receipt,
      {
        ownerId: value.ownerId,
        projectId: value.projectId,
        taskId: value.taskId,
      },
      receipt.readiness.observedAt,
    );
    requireTask(
      value.operations.filter(
        (operation) =>
          canonicalJson(operation) === canonicalJson(command.component),
      ).length === 1,
      "A saved attachment must match exactly one prepared component operation.",
    );
  }
  boundedJson(value, TASK_LIMITS.artifactBytes, "Prepared result artifact");
  return structuredClone(value);
}

/** The runner supplies an actual owned task; model output supplies only proposed operations. */
export function prepareTaskResult(task, operations, attachment = null) {
  const current = parseTaskRecord(task);
  return parsePreparedTaskResult({
    kind: "component_changes",
    ownerId: current.ownerId,
    projectId: current.input.projectId,
    taskId: current.id,
    baseFingerprint: current.input.context.fingerprint,
    operations,
    attachment,
  });
}

export function matchPreparedTaskResult(value, task) {
  const result = parsePreparedTaskResult(value);
  const current = parseTaskRecord(task);
  requireTask(
    result.ownerId === current.ownerId &&
      result.projectId === current.input.projectId &&
      result.taskId === current.id &&
      result.baseFingerprint === current.input.context.fingerprint,
    "Prepared result does not belong to this account, task and starting project.",
  );
  return result;
}

/** Local apply-once metadata. It grants no access and contains no generated source. */
export function parseTaskApplication(value) {
  object(
    value,
    ["ownerId", "projectId", "taskId", "artifact"],
    "Task application receipt",
  );
  const { ownerId, projectId, taskId } = value;
  parseTaskReference({ ownerId, projectId, taskId });
  validateArtifact(value.artifact);
  return structuredClone(value);
}

/** The immutable artifact's bytes have one ordering on both producer and consumer. */
export function serializePreparedTaskResult(value) {
  const canonical = (item) =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, canonical(item[key])]),
          )
        : item;
  return JSON.stringify(canonical(parsePreparedTaskResult(value)));
}
