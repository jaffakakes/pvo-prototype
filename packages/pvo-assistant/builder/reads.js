import {
  requireTask,
  object,
  integer,
  digest,
  list,
  unique,
  text,
} from "../tasks/validation.js";
import {
  SERVICE_PACKAGE_LIMITS,
  parseServiceFilePath,
} from "../services/index.js";
import {
  parseWorkspaceSnapshot,
  WORKSPACE_LIMITS,
} from "../workspaces/index.js";
import { BUILDER_TOOL_LIMITS, parseBuilderTool } from "./tools.js";

const bytes = (value) => new TextEncoder().encode(value).length;

/** Project only authoritative saved source into bounded model feedback. */
export function readBuilderWorkspace(snapshot, input) {
  const tool = parseBuilderTool(input);
  const source = snapshot === null ? null : parseWorkspaceSnapshot(snapshot);
  if (tool.kind === "workspace_list")
    return {
      revision: source?.revision ?? 0,
      digest: source?.digest ?? null,
      files:
        source?.files.map((file) => ({
          path: file.path,
          bytes: bytes(file.content),
        })) ?? [],
    };
  requireTask(
    tool.kind === "workspace_read",
    "This tool is not a source read.",
  );
  requireTask(
    source?.revision === tool.revision,
    "Workspace source changed; list its current revision.",
  );
  const file = source.files.find((file) => file.path === tool.path);
  requireTask(file, "The requested saved source file is absent.");
  const points = [...file.content];
  requireTask(
    tool.offset <= points.length,
    "Read offset exceeds the saved source.",
  );
  let next = tool.offset,
    size = 0,
    content = "";
  while (next < points.length) {
    const point = points[next];
    const length = bytes(point);
    if (size + length > BUILDER_TOOL_LIMITS.readBytes) break;
    content += point;
    size += length;
    next++;
  }
  return {
    revision: source.revision,
    digest: source.digest,
    path: file.path,
    offset: tool.offset,
    content,
    nextOffset: next < points.length ? next : null,
  };
}

/** Reject adapter metadata, ownership and success claims from model-visible read results. */
export function parseBuilderReadResult(input, value) {
  const tool = parseBuilderTool(input);
  if (tool.kind === "workspace_list") {
    object(value, ["revision", "digest", "files"], "Workspace file list");
    integer(value.revision, WORKSPACE_LIMITS.operations, "Source revision");
    if (value.revision === 0)
      requireTask(value.digest === null, "An empty workspace has no digest.");
    else digest(value.digest, "Source digest");
    list(value.files, SERVICE_PACKAGE_LIMITS.files, "Workspace files");
    for (const file of value.files) {
      object(file, ["path", "bytes"], "File metadata");
      parseServiceFilePath(file.path);
      integer(file.bytes, SERVICE_PACKAGE_LIMITS.fileBytes, "File bytes");
    }
    unique(
      value.files.map((file) => file.path),
      "File paths",
    );
    requireTask(
      value.revision !== 0 || value.files.length === 0,
      "Unsaved workspace cannot contain files.",
    );
  } else {
    requireTask(tool.kind === "workspace_read", "Not a source read.");
    object(
      value,
      ["revision", "digest", "path", "offset", "content", "nextOffset"],
      "Workspace file content",
    );
    requireTask(
      value.revision === tool.revision &&
        value.path === tool.path &&
        value.offset === tool.offset,
      "Source feedback does not match its read.",
    );
    digest(value.digest, "Source digest");
    text(value.content, BUILDER_TOOL_LIMITS.readBytes, "Source content", true);
    if (value.nextOffset !== null) {
      integer(
        value.nextOffset,
        SERVICE_PACKAGE_LIMITS.fileBytes,
        "Next code-point offset",
        value.offset + 1,
      );
      requireTask(
        value.nextOffset === value.offset + [...value.content].length,
        "Source offset does not match its content.",
      );
    }
  }
  return structuredClone(value);
}
