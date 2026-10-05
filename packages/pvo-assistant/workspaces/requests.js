import {
  digest,
  id,
  integer,
  list,
  object,
  requireTask,
  time,
} from "../tasks/validation.js";
import { TASK_LIMITS } from "../tasks/limits.js";
import { parseServiceFiles, parseServiceFilePath } from "../services/index.js";
import { WORKSPACE_LIMITS as limits } from "./contract.js";

export function parseWorkspaceSave(value) {
  object(value, ["id", "expectedRevision", "files"], "Workspace save");
  id(value.id, "Workspace operation ID");
  integer(
    value.expectedRevision,
    limits.operations,
    "Expected source revision",
  );
  return {
    id: value.id,
    expectedRevision: value.expectedRevision,
    files: parseServiceFiles(value.files),
  };
}

export function parseWorkspaceRun(value, command = false) {
  object(
    value,
    command
      ? ["id", "revision", "digest", "command"]
      : ["id", "revision", "digest"],
    "Workspace execution",
  );
  id(value.id, "Workspace operation ID");
  integer(value.revision, limits.operations, "Source revision", 1);
  digest(value.digest, "Source digest");
  if (command) {
    object(value.command, ["kind", "paths"], "Workspace command");
    requireTask(
      ["check", "test"].includes(value.command.kind),
      "Unsupported workspace command.",
    );
    list(
      value.command.paths,
      value.command.kind === "check" ? 1 : 8,
      "Command paths",
    );
    requireTask(value.command.paths.length > 0, "Command paths are required.");
    for (const path of value.command.paths) {
      parseServiceFilePath(path);
      requireTask(
        value.command.kind !== "test" || path.startsWith("tests/"),
        "Tests must be under tests/.",
      );
    }
    requireTask(
      new Set(value.command.paths).size === value.command.paths.length,
      "Command paths must be unique.",
    );
  }
  return structuredClone(value);
}

export function parseWorkspaceLease(value) {
  object(
    value,
    [
      "id",
      "resourceId",
      "session",
      "sourceRevision",
      "startedAt",
      "deadlineAt",
      "expiresAt",
    ],
    "Workspace lease",
  );
  requireTask(
    typeof value.resourceId === "string" &&
      /^workspace-[a-f0-9]{64}$/.test(value.resourceId),
    "Invalid workspace resource ID.",
  );
  integer(value.session, limits.sessions, "Workspace session", 1);
  requireTask(
    value.id === `${value.resourceId}-${value.session}`,
    "Invalid workspace lease ID.",
  );
  integer(value.sourceRevision, limits.operations, "Source revision", 1);
  for (const field of ["startedAt", "deadlineAt", "expiresAt"])
    time(value[field], `Lease ${field}`);
  requireTask(
    value.deadlineAt > value.startedAt &&
      value.deadlineAt - value.startedAt <= limits.sessionMs,
    "Invalid workspace session lifetime.",
  );
  requireTask(
    value.expiresAt >= value.deadlineAt &&
      value.expiresAt - value.startedAt <= TASK_LIMITS.lifetimeMs,
    "Invalid workspace reservation retention.",
  );
  return structuredClone(value);
}

export function workspaceCommandArguments(command) {
  return [
    "node",
    command.kind === "check" ? "--check" : "--test",
    ...command.paths,
  ];
}
