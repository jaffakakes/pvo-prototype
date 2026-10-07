import nanoid from "./libraries/nanoid-5.1.6.js";
import {
  object,
  list,
  unique,
  boundedJson,
  requireTask,
} from "../tasks/validation.js";
import { parseServiceFiles, parseServiceFilePath } from "./files.js";
import { SERVICE_PACKAGE_LIMITS } from "./limits.js";
import { canonicalJson } from "./json.js";

const libraries = new Map([[nanoid.name, canonicalJson(nanoid)]]);

/** Exact retained bytes only. No package resolution or install scripts during invocation. */
export function parseNodeDependencies(value) {
  list(value, libraries.size, "Supported locked libraries");
  for (const dependency of value) {
    requireTask(
      dependency &&
        libraries.get(dependency.name) === canonicalJson(dependency),
      "Unsupported or changed locked library. Select a supported exact version.",
    );
  }
  unique(
    value.map((dependency) => dependency.name),
    "Locked libraries",
  );
  return structuredClone(value);
}

export function supportedNodeLibraries() {
  return [...libraries.values()].map((value) => JSON.parse(value));
}

/** Trusted pre-start admission. This carries code, never platform test expectations or permissions. */
export function parseNodeBundle(value) {
  object(value, ["entrypoint", "files", "dependencies"], "Node source bundle");
  parseServiceFilePath(value.entrypoint);
  const files = parseServiceFiles(value.files);
  requireTask(
    value.entrypoint.startsWith("src/") &&
      files.some((file) => file.path === value.entrypoint),
    "Missing Node entry point.",
  );
  parseNodeDependencies(value.dependencies);
  boundedJson(value, SERVICE_PACKAGE_LIMITS.packageBytes, "Node source bundle");
  return structuredClone(value);
}
