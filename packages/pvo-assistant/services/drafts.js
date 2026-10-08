import {
  object,
  id,
  integer,
  text,
  list,
  unique,
  boundedJson,
  requireTask,
} from "../tasks/validation.js";
import { parseNodeDependencies } from "./nodeBundle.js";
import { parseServiceAgreement } from "./agreement.js";
import { parseServiceFiles, parseServiceFilePath } from "./files.js";
import { canonicalJson } from "./json.js";
import { SERVICE_PACKAGE_LIMITS } from "./limits.js";

export const SERVICE_DRAFT_LIMITS = Object.freeze({
  bytes: 1536 * 1024,
  receipts: 16,
});

/** Saving unfinished source does not validate execution or grant publication. */
export function parseServiceDraftContent(value) {
  object(
    value,
    [
      "description",
      "agreement",
      "entrypoint",
      "files",
      "tests",
      "dependencies",
    ],
    "Container draft content",
  );
  text(value.description, 2048, "Container description");
  if (value.agreement !== null) parseServiceAgreement(value.agreement);
  parseServiceFilePath(value.entrypoint);
  requireTask(
    value.entrypoint.startsWith("src/"),
    "The entry point must be a source file.",
  );
  parseServiceFiles(value.files);
  list(value.tests, SERVICE_PACKAGE_LIMITS.tests, "Selected tests");
  for (const path of value.tests) {
    parseServiceFilePath(path);
    requireTask(path.startsWith("tests/"), "Tests must be under tests/.");
  }
  unique(value.tests, "Selected tests");
  parseNodeDependencies(value.dependencies);
  boundedJson(value, SERVICE_DRAFT_LIMITS.bytes, "Container draft");
  return structuredClone(value);
}
export function parseServiceDraft(value) {
  object(
    value,
    ["identity", "revision", "content", "updatedAt"],
    "Container draft",
  );
  object(
    value.identity,
    ["serviceId", "ownerId", "projectId"],
    "Container owner",
  );
  for (const key of Object.keys(value.identity)) id(value.identity[key], key);
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Draft revision");
  integer(value.updatedAt, 8640000000000000, "Draft update time", 1);
  parseServiceDraftContent(value.content);
  return structuredClone(value);
}
export function parseServiceDraftSave(value) {
  object(value, ["actionId", "expectedRevision", "content"], "Save draft");
  id(value.actionId, "Draft action");
  integer(
    value.expectedRevision,
    Number.MAX_SAFE_INTEGER - 1,
    "Expected draft revision",
  );
  parseServiceDraftContent(value.content);
  return structuredClone(value);
}
export const serializeServiceDraftSave = (value) =>
  canonicalJson(parseServiceDraftSave(value));
export function newServiceDraftContent(description) {
  return parseServiceDraftContent({
    description,
    agreement: null,
    entrypoint: "src/main.mjs",
    files: [],
    tests: [],
    dependencies: [],
  });
}
