import { TASK_LIMITS } from "../tasks/index.js";
import {
  boundedJson,
  digest,
  id,
  integer,
  object,
  requireTask,
  text,
} from "../tasks/validation.js";

export const INACTIVE_SERVICE_LIMITS = Object.freeze({
  sourceBytes: 1024 * 1024,
  inputBytes: 4096,
  outputBytes: 4096,
  probes: 20,
  cpuMs: 50,
  probeMs: 15000,
});

export function parseServiceIdentity(value) {
  object(
    value,
    [
      "resourceId",
      "ownerId",
      "projectId",
      "taskId",
      "operationId",
      "sourceDigest",
      "expiresAt",
    ],
    "Service release identity",
  );
  for (const key of [
    "resourceId",
    "ownerId",
    "projectId",
    "taskId",
    "operationId",
  ])
    id(value[key], "Service release ID");
  digest(value.sourceDigest, "Service source digest");
  integer(value.expiresAt, 8640000000000000, "Inactive service expiry", 1);
  return structuredClone(value);
}

const identityValues = (identity) => [
  identity.resourceId,
  identity.ownerId,
  identity.projectId,
  identity.taskId,
  identity.operationId,
  identity.sourceDigest,
  identity.expiresAt,
];
export const sameServiceIdentity = (a, b) =>
  JSON.stringify(identityValues(a)) === JSON.stringify(identityValues(b));

export function parseServiceSource(value) {
  text(value, INACTIVE_SERVICE_LIMITS.sourceBytes, "Service source");
  return value;
}

export function parseServicePublication(value) {
  object(value, ["identity", "source"], "Service publication");
  const identity = parseServiceIdentity(value.identity);
  parseServiceSource(value.source);
  boundedJson(value, TASK_LIMITS.artifactBytes, "Service publication");
  return { identity, source: value.source };
}

export const serializeServiceIdentity = (value) =>
  JSON.stringify(identityValues(parseServiceIdentity(value)));

export function parseServiceObservation(value, expected) {
  object(value, ["identity", "state"], "Provider observation");
  const identity = parseServiceIdentity(value.identity);
  requireTask(
    sameServiceIdentity(identity, expected),
    "Provider returned a different owned service.",
  );
  requireTask(
    ["missing", "available", "deleted"].includes(value.state),
    "Provider state is unsupported.",
  );
  return { identity, state: value.state };
}
