import {
  boundedJson,
  choice,
  digest,
  integer,
  list,
  object,
  requireTask,
} from "../tasks/validation.js";
import {
  parseServiceFilePath,
  parseServiceFiles,
  serializeServiceFiles,
  SERVICE_PACKAGE_LIMITS,
} from "../services/index.js";
import { parseWorkspaceOperationId } from "../workspaces/index.js";

export const BUILDER_TOOL_LIMITS = Object.freeze({
  readBytes: 4096,
});
export const BUILDER_TOOL_KINDS = Object.freeze([
  "workspace_list",
  "workspace_read",
  "workspace_write",
  "workspace_start",
  "workspace_check",
  "workspace_test",
  "workspace_result",
]);
const fields = {
  workspace_list: [],
  workspace_read: ["revision", "path", "offset"],
  workspace_write: ["expectedRevision", "files"],
  workspace_start: ["revision", "digest"],
  workspace_check: ["revision", "digest", "path"],
  workspace_test: ["revision", "digest", "paths"],
  workspace_result: ["operationId"],
};

/** Model-visible input contains source intent only; task ownership and operation IDs are host-owned. */
export function parseBuilderTool(value) {
  requireTask(
    value && typeof value === "object",
    "Workspace tool must be an object.",
  );
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  choice(kind, BUILDER_TOOL_KINDS, "Workspace tool");
  requireTask(
    !Object.hasOwn(value, "review"),
    "The review field belongs only to the top-level tools decision. Remove it from the workspace tool inside calls; retain only that tool's exact schema fields.",
  );
  const keys = ["kind", ...fields[kind]];
  object(
    value,
    keys,
    `Workspace tool ${kind} (exact fields: ${keys.join(", ")})`,
  );
  if (value.revision !== undefined)
    integer(value.revision, Number.MAX_SAFE_INTEGER, "Source revision", 1);
  if (value.digest !== undefined) digest(value.digest, "Source digest");
  if (value.path !== undefined) parseServiceFilePath(value.path);
  if (value.kind === "workspace_write") {
    integer(
      value.expectedRevision,
      Number.MAX_SAFE_INTEGER,
      "Expected source revision",
    );
    parseServiceFiles(value.files);
  }
  if (value.kind === "workspace_read")
    integer(
      value.offset,
      SERVICE_PACKAGE_LIMITS.fileBytes,
      "Code-point offset",
    );
  if (value.kind === "workspace_test") {
    list(value.paths, 8, "Test paths");
    requireTask(value.paths.length > 0, "Choose one to eight tests.");
    requireTask(
      new Set(value.paths).size === value.paths.length,
      "Test paths must be unique.",
    );
    for (const path of value.paths) {
      parseServiceFilePath(path);
      requireTask(path.startsWith("tests/"), "Tests must be under tests/.");
    }
  }
  if (value.kind === "workspace_result")
    parseWorkspaceOperationId(value.operationId);
  boundedJson(
    value,
    SERVICE_PACKAGE_LIMITS.packageBytes + 1024,
    "Workspace tool",
  );
  return structuredClone(value);
}

export function serializeBuilderTool(value) {
  const tool = parseBuilderTool(value);
  return JSON.stringify([
    tool.kind,
    ...fields[tool.kind].map((field) =>
      field === "files" ? serializeServiceFiles(tool.files) : tool[field],
    ),
  ]);
}
