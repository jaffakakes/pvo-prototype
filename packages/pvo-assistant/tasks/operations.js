import { TASK_LIMITS as limits } from "./limits.js";
import { validateArtifact, validateFailure } from "./content.js";
import {
  choice,
  digest,
  id,
  list,
  object,
  requireTask,
  time,
  unique,
} from "./validation.js";

export function validateOperation(value) {
  object(
    value,
    [
      "id",
      "stepId",
      "inputDigest",
      "status",
      "resources",
      "artifact",
      "failure",
      "createdAt",
      "updatedAt",
    ],
    "Operation receipt",
  );
  id(value.id, "Operation ID");
  id(value.stepId, "Operation step ID");
  digest(value.inputDigest, "Operation input digest");
  choice(
    value.status,
    ["planned", "unknown", "completed", "absent", "failed"],
    "Operation status",
  );
  list(value.resources, limits.resources, "Operation resources");
  for (const resource of value.resources) {
    object(resource, ["kind", "id"], "Resource reference");
    choice(
      resource.kind,
      ["workspace", "service", "artifact"],
      "Resource kind",
    );
    id(resource.id, "Resource ID");
  }
  unique(
    value.resources.map((resource) => `${resource.kind}:${resource.id}`),
    "Resource references",
  );
  if (value.artifact !== null) validateArtifact(value.artifact);
  if (value.failure !== null) validateFailure(value.failure);
  requireTask(
    (value.status === "failed") === (value.failure !== null),
    "Operation failure does not match its status.",
  );
  if (value.failure)
    requireTask(
      value.failure.stepId === value.stepId,
      "Operation failure refers to a different step.",
    );
  if (value.artifact)
    requireTask(
      value.status === "completed",
      "Only completed operations have artifact results.",
    );
  time(value.createdAt, "Operation creation time");
  time(value.updatedAt, "Operation update time");
  requireTask(
    value.updatedAt >= value.createdAt,
    "Operation timestamps are reversed.",
  );
}

// Canonical receipt fields avoid object insertion order affecting duplicate checks.
function sameReceipt(a, b) {
  return (
    a.status === b.status &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    JSON.stringify(a.resources.map((item) => [item.kind, item.id])) ===
      JSON.stringify(b.resources.map((item) => [item.kind, item.id])) &&
    (a.artifact === null
      ? b.artifact === null
      : b.artifact !== null &&
        a.artifact.id === b.artifact.id &&
        a.artifact.sha256 === b.artifact.sha256 &&
        a.artifact.bytes === b.artifact.bytes) &&
    (a.failure === null
      ? b.failure === null
      : b.failure !== null &&
        a.failure.code === b.failure.code &&
        a.failure.stepId === b.failure.stepId)
  );
}

/** Pure receipt update. The caller must persist it atomically before performing an effect. */
export function updateOperation(operations, incoming, now) {
  validateOperation(incoming);
  const index = operations.findIndex((item) => item.id === incoming.id);
  if (index === -1) {
    requireTask(
      incoming.updatedAt === now,
      "Operation update must use the command time.",
    );
    requireTask(
      !hasUnsettledOperations(operations),
      "Reconcile the existing operation before planning another.",
    );
    requireTask(
      operations.length < limits.operations,
      "Operation history is full.",
    );
    requireTask(
      incoming.status === "planned" &&
        incoming.createdAt === now &&
        !incoming.resources.length,
      "A new operation must first record an empty planned intent.",
    );
    return [...operations, structuredClone(incoming)];
  }
  const prior = operations[index];
  requireTask(
    prior.inputDigest === incoming.inputDigest &&
      prior.stepId === incoming.stepId,
    "Operation identity conflicts with its original input.",
  );
  requireTask(
    prior.createdAt === incoming.createdAt &&
      incoming.updatedAt >= prior.updatedAt,
    "Operation identity or time cannot be rewritten.",
  );
  if (sameReceipt(prior, incoming)) return operations;
  requireTask(
    incoming.updatedAt === now,
    "Operation update must use the command time.",
  );
  requireTask(
    ["planned", "unknown"].includes(prior.status),
    "A settled operation receipt is immutable.",
  );
  requireTask(
    ["unknown", "completed", "absent", "failed"].includes(incoming.status),
    "An uncertain operation cannot become a new attempt.",
  );
  for (const resource of prior.resources)
    requireTask(
      incoming.resources.some(
        (item) => item.kind === resource.kind && item.id === resource.id,
      ),
      "Known resource references cannot be discarded.",
    );
  return operations.map((item, at) =>
    at === index ? structuredClone(incoming) : item,
  );
}

export function hasUnsettledOperations(operations) {
  return operations.some((item) =>
    ["planned", "unknown"].includes(item.status),
  );
}
