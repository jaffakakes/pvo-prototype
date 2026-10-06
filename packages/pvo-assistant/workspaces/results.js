import {
  choice,
  digest,
  id,
  integer,
  object,
  requireTask,
  text,
  time,
} from "../tasks/validation.js";
import {
  WORKSPACE_LIMITS as limits,
  parseWorkspaceIdentity,
  parseWorkspaceSnapshot,
  serializeWorkspaceIdentity,
} from "./contract.js";
import { parseWorkspaceGrant } from "./grants.js";
import { parseWorkspaceLease } from "./requests.js";

export function parseWorkspaceReceipt(value) {
  object(
    value,
    ["id", "kind", "digest", "status", "result"],
    "Workspace receipt",
  );
  id(value.id, "Workspace operation ID");
  choice(value.kind, ["save", "start", "command"], "Workspace operation kind");
  digest(value.digest, "Workspace operation digest");
  choice(
    value.status,
    ["pending", "completed", "interrupted"],
    "Workspace operation status",
  );
  if (value.status === "pending")
    requireTask(
      value.result === null,
      "Pending workspace operation cannot have a result.",
    );
  else if (value.status === "interrupted") {
    object(value.result, ["code"], "Workspace interruption");
    choice(
      value.result.code,
      [
        "workspace_stopped",
        "workspace_claim_revoked",
        "workspace_execution_interrupted",
        "workspace_budget_exhausted",
        "workspace_provider_unavailable",
        "workspace_output_limit",
      ],
      "Workspace failure code",
    );
  } else if (value.kind === "command") {
    object(
      value.result,
      ["stdout", "stderr", "exitCode"],
      "Workspace command result",
    );
    for (const field of ["stdout", "stderr"])
      text(value.result[field], limits.outputBytes, `Command ${field}`, true);
    requireTask(
      new TextEncoder().encode(value.result.stdout + value.result.stderr)
        .byteLength <= limits.outputBytes,
      "Combined workspace output exceeds its byte limit.",
    );
    integer(value.result.exitCode, 65535, "Command exit code", -255);
  } else {
    object(
      value.result,
      value.kind === "start"
        ? ["revision", "digest", "deadlineAt"]
        : ["revision", "digest"],
      "Workspace source reference",
    );
    integer(value.result.revision, limits.operations, "Source revision", 1);
    digest(value.result.digest, "Source digest");
    if (value.kind === "start")
      time(value.result.deadlineAt, "Workspace session deadline");
  }
  return structuredClone(value);
}

export function parseWorkspaceObservation(value, expected) {
  object(
    value,
    [
      "identity",
      "closed",
      "cleanupRequired",
      "cleanupAttempts",
      "active",
      "grant",
      "revokedThrough",
      "lease",
      "source",
    ],
    "Workspace observation",
  );
  const identity = parseWorkspaceIdentity(value.identity);
  requireTask(
    serializeWorkspaceIdentity(identity) ===
      serializeWorkspaceIdentity(expected),
    "Workspace observation belongs to a different task.",
  );
  for (const field of ["closed", "cleanupRequired"])
    requireTask(
      typeof value[field] === "boolean",
      `Workspace ${field} must be boolean.`,
    );
  integer(
    value.cleanupAttempts,
    limits.cleanupAttempts,
    "Workspace cleanup attempts",
  );
  integer(
    value.revokedThrough,
    Number.MAX_SAFE_INTEGER,
    "Revoked task generation",
  );
  if (value.active !== null) {
    object(
      value.active,
      ["id", "kind", "generation", "deadlineAt"],
      "Active workspace operation",
    );
    id(value.active.id, "Workspace operation ID");
    choice(value.active.kind, ["start", "command"], "Workspace operation kind");
    integer(
      value.active.generation,
      Number.MAX_SAFE_INTEGER,
      "Workspace operation generation",
      1,
    );
    time(value.active.deadlineAt, "Workspace operation deadline");
  }
  if (value.grant !== null) parseWorkspaceGrant(value.grant);
  if (value.lease !== null)
    requireTask(
      parseWorkspaceLease(value.lease).resourceId === identity.resourceId,
      "Workspace lease belongs to a different resource.",
    );
  if (value.source !== null) parseWorkspaceSnapshot(value.source);
  return structuredClone(value);
}
