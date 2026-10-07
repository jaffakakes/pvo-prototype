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

const fields = {
  read: ["path", "offset"],
  write: [
    "expectedRevision",
    "files",
    "entrypoint",
    "tests",
    "agreementJson",
    "libraries",
  ],
  replace: ["expectedRevision", "path", "start", "end", "content"],
  ask: ["prompt", "choices"],
  execute: ["reason"],
  done: [],
};
export function parseDraftDecision(value) {
  const kind = value?.kind;
  choice(kind, Object.keys(fields), "Draft decision");
  object(value, ["kind", ...fields[kind]], "Draft decision");
  if (kind === "read") {
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
    integer(value.start, 128 * 1024, "Replacement start");
    integer(value.end, 128 * 1024, "Replacement end", value.start);
    text(value.content, 128 * 1024, "Replacement source", true);
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
    const points = Array.from(file.content);
    requireTask(
      decision.end <= points.length,
      "Replacement is outside the saved file.",
    );
    files.set(file.path, {
      path: file.path,
      content:
        points.slice(0, decision.start).join("") +
        decision.content +
        points.slice(decision.end).join(""),
    });
  } else for (const file of decision.files) files.set(file.path, file);
  return {
    actionId,
    expectedRevision: decision.expectedRevision,
    content: parseServiceDraftContent({
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
    }),
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
