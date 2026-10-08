import { parseDraftTestResults } from "../../../../packages/pvo-assistant/results/index.js";
import {
  parseTaskInput,
  parseTaskRecord,
  parseTaskReference,
  TASK_LIMITS,
  type TaskInput,
  type TaskRecord,
  type TaskReference,
} from "../../../../packages/pvo-assistant/tasks/index.js";
import { AssistantServiceError } from "../../domain/assistant/failure";
import { readAssistantJson } from "./serviceResponse";

export class SavedTaskHttpError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? "Sign in again to open this task."
        : status === 409
          ? "The task changed. Refresh its saved progress before trying again."
          : status === 410
            ? "This task has expired."
            : status === 404
              ? "This task could not be found for your account."
              : status === 429
                ? "The saved task limit has been reached. Try again later."
                : "Could not reach the saved task. Retry to recover the same request.",
    );
  }
}

/** Cookie-authenticated same-origin transport. No task URL or credential comes from model output. */
async function requestTask(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  const combined = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: combined,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SavedTaskHttpError(response.status);
  }
  const value = await readAssistantJson(
    response,
    combined,
    TASK_LIMITS.recordBytes + 1024,
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AssistantServiceError(422);
  return value as Record<string, unknown>;
}

export async function resolveTaskProject(
  localId: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await requestTask(
    "/api/assistant/projects",
    { localId },
    signal,
  );
  const project = response.project as { id?: unknown } | undefined;
  if (
    typeof project?.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(project.id)
  )
    throw new AssistantServiceError(422);
  return project.id;
}

export async function createSavedTask(input: TaskInput, signal: AbortSignal) {
  return parseTaskRecord(
    (await requestTask("/api/assistant/tasks", parseTaskInput(input), signal))
      .task,
  );
}

export async function readSavedTask(
  reference: TaskReference,
  signal: AbortSignal,
) {
  const ref = parseTaskReference(reference);
  return ownedResponse(
    (await requestTask(`/api/assistant/tasks/${ref.taskId}`, undefined, signal))
      .task,
    ref,
  );
}

function ownedResponse(value: unknown, ref: TaskReference) {
  const task = parseTaskRecord(value);
  if (
    task.id !== ref.taskId ||
    task.ownerId !== ref.ownerId ||
    task.input.projectId !== ref.projectId
  )
    throw new Error("The saved task does not match this account and project.");
  return task;
}

export type SavedTaskAction =
  | { kind: "stop" | "resume" }
  | {
      kind: "manual";
      questionId: string;
      stepId: string;
      operationId: string;
      status: "completed" | "cancelled";
      note: string;
    }
  | { kind: "answer"; questionId: string; operationId: string; value: string };

export async function changeSavedTask(
  task: TaskRecord,
  action: SavedTaskAction,
  signal: AbortSignal,
) {
  const current = parseTaskRecord(task);
  const ref = {
    ownerId: current.ownerId,
    projectId: current.input.projectId,
    taskId: current.id,
  };
  const body =
    action.kind === "answer"
      ? {
          expectedRevision: current.revision,
          questionId: action.questionId,
          questionRevision: 0,
          operationId: action.operationId,
          value: action.value,
        }
      : action.kind === "manual"
        ? {
            expectedRevision: current.revision,
            questionId: action.questionId,
            stepId: action.stepId,
            operationId: action.operationId,
            status: action.status,
            note: action.note,
          }
        : { expectedRevision: current.revision };
  const path = action.kind === "answer" ? "answers" : action.kind;
  return ownedResponse(
    (
      await requestTask(
        `/api/assistant/tasks/${current.id}/${path}`,
        body,
        signal,
      )
    ).task,
    ref,
  );
}

export async function readDraftTests(task: TaskRecord, signal: AbortSignal) {
  const report = parseDraftTestResults(
    (
      await requestTask(
        `/api/assistant/tasks/${task.id}/tests`,
        undefined,
        signal,
      )
    ).tests,
  );
  if (
    !("container" in task.input.context) ||
    report.ownerId !== task.ownerId ||
    report.taskId !== task.id ||
    report.serviceId !== task.input.context.container.serviceId
  )
    throw new Error("The test report belongs to another task or Container.");
  return report;
}
