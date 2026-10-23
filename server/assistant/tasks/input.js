import {
  parseTaskInput,
  TASK_LIMITS,
} from "../../../packages/pvo-assistant/tasks/index.js";
import { HttpError } from "../../http.js";

export const TASK_STORAGE_LIMITS = Object.freeze({
  projects: 64,
  retained: 32,
  active: 2,
  daily: 8,
  identities: 4096,
  page: 20,
});

export function fields(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new HttpError(
      400,
      "The task request has missing or unsupported fields.",
    );
}

export function taskId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new HttpError(400, "A valid task or project identifier is required.");
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new HttpError(400, "A saved task revision is required.");
}

export function projectInput(value) {
  fields(value, ["localId"]);
  if (
    typeof value.localId !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(value.localId)
  )
    throw new HttpError(400, "A saved local project identifier is required.");
  return value;
}

export function creationInput(value) {
  try {
    return parseTaskInput(value);
  } catch {
    throw new HttpError(
      400,
      "The task request is invalid or exceeds its limits.",
    );
  }
}

export function creatorCommand(action, value) {
  if (action === "manual") {
    fields(value, [
      "expectedRevision",
      "questionId",
      "stepId",
      "operationId",
      "status",
      "note",
    ]);
    revision(value.expectedRevision);
    for (const key of ["questionId", "stepId", "operationId"])
      taskId(value[key]);
    if (
      !["completed", "cancelled"].includes(value.status) ||
      typeof value.note !== "string" ||
      !value.note.trim() ||
      new TextEncoder().encode(value.note).length > 1000
    )
      throw new HttpError(
        400,
        "Describe the manual result in at most 1,000 bytes.",
      );
    const { expectedRevision, ...command } = value;
    return {
      expectedRevision,
      command: { kind: "resolve_manual", ...command },
    };
  }
  const answer = action === "answers";
  fields(
    value,
    answer
      ? [
          "expectedRevision",
          "questionId",
          "questionRevision",
          "operationId",
          "value",
        ]
      : ["expectedRevision"],
  );
  revision(value.expectedRevision);
  if (answer) {
    taskId(value.questionId);
    taskId(value.operationId);
    if (
      value.questionRevision !== 0 ||
      typeof value.value !== "string" ||
      !value.value.trim() ||
      new TextEncoder().encode(value.value).length > TASK_LIMITS.answerBytes
    )
      throw new HttpError(400, "The answer is invalid or exceeds its limits.");
    return {
      expectedRevision: value.expectedRevision,
      command: {
        kind: "answer",
        questionId: value.questionId,
        questionRevision: 0,
        operationId: value.operationId,
        value: value.value,
      },
    };
  }
  if (!["resume", "stop"].includes(action))
    throw new HttpError(404, "This task operation is unavailable.");
  return {
    expectedRevision: value.expectedRevision,
    command: { kind: action },
  };
}

export function taskListInput(params) {
  if (
    [...params.keys()].some(
      (key) =>
        !["project", "before", "limit"].includes(key) ||
        params.getAll(key).length !== 1,
    )
  )
    throw new HttpError(400, "The task list query is invalid.");
  const projectId = taskId(params.get("project"));
  const before = params.has("before") ? taskId(params.get("before")) : null;
  const rawLimit = params.get("limit") ?? "20";
  const limit = Number(rawLimit);
  if (!/^[1-9]\d?$/.test(rawLimit) || limit > TASK_STORAGE_LIMITS.page)
    throw new HttpError(400, "Request between one and twenty tasks.");
  return { projectId, before, limit };
}

// Canonical key ordering makes identical validated JSON hash identically.
export async function creationDigest(value) {
  const canonical = (item) => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, canonical(item[key])]),
      );
    return item;
  };
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
