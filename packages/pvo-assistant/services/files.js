import {
  boundedJson,
  list,
  object,
  requireTask as requireService,
  text,
  unique,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS as limits } from "./limits.js";
import { canonicalJson } from "./json.js";

export function parseServiceFilePath(value) {
  text(value, 160, "Service file path");
  requireService(
    /^(src|tests)\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_.-]*\.mjs$/.test(
      value,
    ) && !value.includes(".."),
    "Service files need unambiguous relative .mjs paths under src/ or tests/.",
  );
  return value;
}

/** Draft snapshots may be empty; complete packages also require an entry point and tests. */
export function parseServiceFiles(value) {
  list(value, limits.files, "Service files");
  for (const file of value) {
    object(file, ["path", "content"], "Service file");
    parseServiceFilePath(file.path);
    text(file.content, limits.fileBytes, "Service file content", true);
  }
  unique(
    value.map((file) => file.path),
    "Service file paths",
  );
  boundedJson(value, limits.packageBytes, "Service files");
  return structuredClone(value);
}

export const serializeServiceFiles = (value) =>
  canonicalJson(parseServiceFiles(value));
