import nanoid from "./libraries/nanoid-5.1.6.js";
import {
  object,
  list,
  unique,
  boundedJson,
  requireTask,
  text,
} from "../tasks/validation.js";
import { parseServiceFiles, parseServiceFilePath } from "./files.js";
import { SERVICE_PACKAGE_LIMITS } from "./limits.js";
import { canonicalJson } from "./json.js";

const libraries = new Map([[nanoid.name, canonicalJson(nanoid)]]);

/** Exact retained bytes only. No package resolution or install scripts during invocation. */
export function parseNodeDependencies(value) {
  list(value, libraries.size, "Supported locked libraries");
  for (const dependency of value) {
    object(
      dependency,
      ["name", "version", "registryIntegrity", "files"],
      "Locked library",
    );
    for (const key of ["name", "version", "registryIntegrity"])
      text(dependency[key], 256, "Library " + key);
    list(dependency.files, 32, "Library files");
    for (const file of dependency.files) {
      object(file, ["path", "content"], "Library file");
      text(file.path, 256, "Library path");
      text(
        file.content,
        SERVICE_PACKAGE_LIMITS.fileBytes,
        "Library source",
        true,
      );
    }
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

/** Model/manual selections resolve only to the platform's retained, reviewed bytes. */
export function resolveNodeLibraries(value) {
  list(value, libraries.size, "Selected Node libraries");
  unique(value, "Selected Node libraries");
  const supported = supportedNodeLibraries();
  return value.map((selected) => {
    text(selected, 256, "Selected Node library");
    const library = supported.find(
      ({ name, version }) => selected === `${name}@${version}`,
    );
    requireTask(!!library, "Select a supported exact Node library version.");
    return library;
  });
}
export function nodeLibraryIds(value) {
  return parseNodeDependencies(value).map(
    ({ name, version }) => `${name}@${version}`,
  );
}
