import {
  parseServiceDraftContent,
  resolveNodeLibraries,
  parseServiceFiles,
  parseServiceFilePath,
} from "../../../packages/pvo-assistant/services/index.js";
import {
  object,
  choice,
  integer,
  text,
  list,
  requireTask,
} from "../../../packages/pvo-assistant/tasks/validation.js";
import { TASK_LIMITS } from "../../../packages/pvo-assistant/tasks/index.js";
import { canonicalJson } from "../../../packages/pvo-assistant/services/json.js";

const fields = {
  diagnose: ["stage", "evidenceKeys", "summary"],
  read: ["path", "offset"],
  read_published: ["path", "offset"],
  write: [
    "expectedRevision",
    "files",
    "entrypoint",
    "tests",
    "agreementJson",
    "libraries",
  ],
  replace: ["expectedRevision", "path", "oldText", "newText"],
  ask: ["prompt", "choices"],
  execute: ["reason"],
  done: [],
};
export function parseDraftDecision(value) {
  const kind = value?.kind;
  choice(kind, Object.keys(fields), "Draft decision");
  object(value, ["kind", ...fields[kind]], "Draft decision");
  if (["read", "read_published"].includes(kind)) {
    parseServiceFilePath(value.path);
    integer(value.offset, 128 * 1024, "Read offset");
  }
  if (kind === "write") {
    resolveNodeLibraries(value.libraries);
    integer(
      value.expectedRevision,
      Number.MAX_SAFE_INTEGER - 1,
      "Draft revision",
    );
    parseServiceFiles(value.files);
    parseServiceFilePath(value.entrypoint);
    list(value.tests, 8, "Selected tests");
    for (const path of value.tests) parseServiceFilePath(path);
    text(value.agreementJson, 256 * 1024, "Agreement JSON");
  }
  if (kind === "replace") {
    integer(
      value.expectedRevision,
      Number.MAX_SAFE_INTEGER - 1,
      "Draft revision",
    );
    parseServiceFilePath(value.path);
    text(value.oldText, 128 * 1024, "Exact source to replace");
    text(value.newText, 128 * 1024, "Replacement source", true);
  }
  if (kind === "ask") {
    text(value.prompt, TASK_LIMITS.questionBytes, "Question");
    list(value.choices, TASK_LIMITS.choices, "Choices");
    for (const option of value.choices)
      text(option, TASK_LIMITS.choiceBytes, "Choice");
  }
  if (kind === "execute")
    text(value.reason, 1024, "Development execution reason");
  return structuredClone(value);
}
export function prepareDraftEdit(saved, decision, actionId) {
  requireTask(
    decision.expectedRevision === saved.draft.revision,
    "Use the supplied saved draft revision.",
  );
  const files = new Map(
    saved.draft.content.files.map((file) => [file.path, file]),
  );
  if (decision.kind === "replace") {
    const file = files.get(decision.path);
    requireTask(!!file, "Choose a saved file path.");
    const start = file.content.indexOf(decision.oldText);
    requireTask(
      start >= 0,
      "The exact source text was not found. Read the current file and copy its existing text exactly.",
    );
    requireTask(
      file.content.indexOf(decision.oldText, start + 1) === -1,
      "The source text occurs more than once. Include enough surrounding text to identify exactly one change.",
    );
    files.set(file.path, {
      path: file.path,
      content:
        file.content.slice(0, start) +
        decision.newText +
        file.content.slice(start + decision.oldText.length),
    });
  } else for (const file of decision.files) files.set(file.path, file);
  const content = parseServiceDraftContent({
    ...saved.draft.content,
    files: [...files.values()],
    ...(decision.kind === "write"
      ? {
          entrypoint: decision.entrypoint,
          dependencies: resolveNodeLibraries(decision.libraries),
          tests: decision.tests,
          agreement: JSON.parse(decision.agreementJson),
        }
      : {}),
  });
  requireTask(
    canonicalJson(content) !== canonicalJson(saved.draft.content),
    "This change is already saved. Use the current source and revision to continue with the remaining tests, agreement or execution; do not repeat the same edit.",
  );
  return {
    actionId,
    expectedRevision: decision.expectedRevision,
    content,
  };
}
export function readDraftFile(saved, path, offset) {
  const file = saved.draft.content.files.find((item) => item.path === path);
  requireTask(!!file, "Choose a saved file path.");
  const points = Array.from(file.content);
  requireTask(offset <= points.length, "Choose an offset inside the file.");
  let text = "",
    cursor = offset,
    bytes = 0;
  while (cursor < points.length) {
    const point = points[cursor];
    const length = new TextEncoder().encode(point).length;
    if (bytes + length > 4096) break;
    text += point;
    bytes += length;
    cursor++;
  }
  return {
    path,
    revision: saved.draft.revision,
    offset,
    content: text,
    nextOffset: cursor < points.length ? cursor : null,
  };
}
