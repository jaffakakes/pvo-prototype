import type {
  TaskInput,
  TaskProposal,
  TaskRecord,
  TaskReference,
} from "../../../../../packages/pvo-assistant/tasks/index.js";
import { cloudTaskInput } from "../../../domain/assistant/cloudTaskInput";
import {
  ownedPendingTask,
  ownedTaskReference,
} from "../../../domain/assistant/taskProjectLink";
import type { ProjectSnapshot } from "../../../domain/project/model";
import type { TaskLinkRequest } from "../../../state/assistant/taskProjectCommands";

type CreationAdapters = {
  begin(): TaskLinkRequest;
  assert(scope: TaskLinkRequest): void;
  stage(scope: TaskLinkRequest, input: TaskInput): TaskLinkRequest;
  finish(scope: TaskLinkRequest, task: TaskRecord): TaskLinkRequest;
  flush(): Promise<void>;
  fingerprint(project: ProjectSnapshot): string;
  resolve(localId: string, signal: AbortSignal): Promise<string>;
  create(input: TaskInput, signal: AbortSignal): Promise<TaskRecord>;
  read(
    reference: TaskReference,
    signal: AbortSignal,
  ): Promise<TaskRecord | null>;
  operationId(): string;
};

/** Save exact retry input before the first POST. Closing a panel never means creation failed. */
export function createSavedTaskWorkflow(adapters: CreationAdapters) {
  let active: { signal: AbortSignal; finished: Promise<void> } | null = null;
  async function submit(
    input: {
      project: ProjectSnapshot;
      request: string;
      proposal: TaskProposal;
    } | null,
    signal: AbortSignal,
    assertProject: () => void = () => {},
  ): Promise<TaskRecord> {
    while (active) {
      if (!active.signal.aborted)
        throw new Error("A task submission is already in progress.");
      // StrictMode/remount may start recovery before an aborted flush has settled.
      // Wait for that exact attempt; do not overlap it or turn cancellation into failure.
      await active.finished;
      signal.throwIfAborted();
    }
    let settle!: () => void;
    const attempt = {
      signal,
      finished: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    active = attempt;
    try {
      let scope = adapters.begin();
      const guard = () => {
        signal.throwIfAborted();
        adapters.assert(scope);
        assertProject();
      };
      guard();
      let pending = ownedPendingTask(scope.links, scope.localId, scope.ownerId);
      if (input && pending)
        throw new Error(
          "Recover the pending task before starting another request.",
        );
      await adapters.flush();
      guard();
      if (input) {
        const previous = ownedTaskReference(
          scope.links,
          scope.localId,
          scope.ownerId,
        );
        if (previous) {
          const task = await adapters.read(previous, signal);
          guard();
          if (
            task &&
            ["queued", "running", "waiting_for_answer", "waiting"].includes(
              task.state,
            )
          )
            throw new Error(
              "Finish or stop the current saved task before starting another.",
            );
        }
        const projectId = await adapters.resolve(scope.localId, signal);
        guard();
        const submission = cloudTaskInput(
          input.project,
          input.request,
          input.proposal,
          {
            projectId,
            operationId: adapters.operationId(),
            fingerprint: adapters.fingerprint(input.project),
          },
        );
        scope = adapters.stage(scope, submission);
        pending = { ownerId: scope.ownerId, input: submission };
      }
      if (!pending) throw new Error("There is no pending task to recover.");
      // This flush is mandatory even when recovering an in-memory failed save.
      await adapters.flush();
      guard();
      const task = await adapters.create(pending.input, signal);
      guard();
      scope = adapters.finish(scope, task);
      await adapters.flush();
      guard();
      return task;
    } finally {
      if (active === attempt) active = null;
      settle();
    }
  }
  return {
    start: (
      input: {
        project: ProjectSnapshot;
        request: string;
        proposal: TaskProposal;
      },
      signal: AbortSignal,
      guard: () => void,
    ) => submit(input, signal, guard),
    recover: (signal: AbortSignal) => submit(null, signal),
  };
}
