import {
  matchPreparedTaskResult,
  type PreparedTaskResult,
  type TaskApplication,
} from "../../../../../packages/pvo-assistant/results/index.js";
import {
  parseTaskRecord,
  type TaskRecord,
  type TaskReference,
} from "../../../../../packages/pvo-assistant/tasks/index.js";
import { nativeProjectFingerprint } from "../../../domain/assistant/native/context";
import type { NativeBatch } from "../../../domain/assistant/native/batch";
import {
  ownedTaskReference,
  recordTaskApplication,
} from "../../../domain/assistant/taskProjectLink";
import type { ProjectSnapshot } from "../../../domain/project/model";
import type { TaskLinkRequest } from "../../../state/assistant/taskProjectCommands";

/** Local storage already reports this through the persistent project recovery surface. */
export class TaskResultSaveError extends Error {
  constructor() {
    super("The project could not be saved.");
  }
}

type ApplicationAdapters = {
  begin(): TaskLinkRequest;
  assert(scope: TaskLinkRequest): void;
  flush(): Promise<void>;
  project(): ProjectSnapshot;
  fingerprint(project: ProjectSnapshot): string;
  read(reference: TaskReference, signal: AbortSignal): Promise<TaskRecord>;
  result(task: TaskRecord, signal: AbortSignal): Promise<PreparedTaskResult>;
  prepare(
    project: ProjectSnapshot,
    result: PreparedTaskResult,
    signal: AbortSignal,
  ): Promise<NativeBatch>;
  commit(
    scope: TaskLinkRequest,
    batch: NativeBatch,
    fingerprint: string,
    receipt: TaskApplication,
  ): TaskLinkRequest;
};

/** Validate an owned immutable result, then commit all changes and its local receipt together. */
export function createTaskApplicationWorkflow(adapters: ApplicationAdapters) {
  let active = false;
  const flush = async () => {
    try {
      await adapters.flush();
    } catch {
      throw new TaskResultSaveError();
    }
  };
  return async (
    reference: TaskReference,
    signal: AbortSignal,
  ): Promise<void> => {
    if (active) throw new Error("A saved result is already being applied.");
    active = true;
    try {
      let scope = adapters.begin();
      const guard = () => {
        signal.throwIfAborted();
        adapters.assert(scope);
        const current = ownedTaskReference(
          scope.links,
          scope.localId,
          scope.ownerId,
        );
        if (
          !current ||
          current.ownerId !== reference.ownerId ||
          current.projectId !== reference.projectId ||
          current.taskId !== reference.taskId
        )
          throw new Error("The current project or saved task changed.");
      };
      guard();
      const task = parseTaskRecord(await adapters.read(reference, signal));
      guard();
      if (
        task.state !== "ready" ||
        !task.result ||
        task.ownerId !== reference.ownerId ||
        task.id !== reference.taskId ||
        task.input.projectId !== reference.projectId
      )
        throw new Error("The task has no matching ready result.");
      const receipt: TaskApplication = {
        ...reference,
        artifact: task.result.artifact,
      };
      const nextLinks = recordTaskApplication(scope.links!, receipt);
      if (nextLinks === scope.links) {
        await flush();
        guard();
        return;
      }
      const result = matchPreparedTaskResult(
        await adapters.result(task, signal),
        task,
      );
      guard();
      await flush();
      guard();
      const project = adapters.project();
      if (adapters.fingerprint(project) !== result.baseFingerprint)
        throw new Error(
          "Your draft changed while this task was working. Your edits and the saved result are both kept; review is needed before applying.",
        );
      const fingerprint = nativeProjectFingerprint(project);
      const batch = await adapters.prepare(project, result, signal);
      guard();
      scope = adapters.commit(scope, batch, fingerprint, receipt);
      await flush();
      guard();
    } finally {
      active = false;
    }
  };
}
