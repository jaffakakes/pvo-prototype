import type {
  TaskRecord,
  TaskReference,
} from "../../../../../packages/pvo-assistant/tasks/index.js";
import { savedTaskStatus } from "../../../domain/assistant/savedTaskStatus";
import {
  SavedTaskHttpError,
  type SavedTaskAction,
} from "../../../infrastructure/assistant/savedTaskTransport";

export type SavedTaskView = {
  task: TaskRecord | null;
  busy: boolean;
  error: string | null;
  signedOut: boolean;
  expired: boolean;
};
type Adapters = {
  current(): boolean;
  read(reference: TaskReference, signal: AbortSignal): Promise<TaskRecord>;
  change(
    task: TaskRecord,
    action: SavedTaskAction,
    signal: AbortSignal,
  ): Promise<TaskRecord>;
  recover(signal: AbortSignal): Promise<TaskRecord>;
  publish(view: SavedTaskView): void;
  expiredSession(): void;
  operationId(): string;
  now(): number;
};

/** Own one visible task subscription. Disposal aborts reads, never sends Stop. */
export function createSavedTaskSession(
  reference: TaskReference | null,
  adapters: Adapters,
) {
  const controller = new AbortController();
  const signal = controller.signal;
  let view: SavedTaskView = {
    task: null,
    busy: false,
    error: null,
    signedOut: false,
    expired: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer: Extract<SavedTaskAction, { kind: "answer" }> | null = null;
  const current = () => !signal.aborted && adapters.current();
  const publish = (values: Partial<SavedTaskView>) => {
    if (!current()) return;
    view = { ...view, ...values };
    adapters.publish(view);
  };
  const schedule = () => {
    clearTimeout(timer);
    if (
      current() &&
      !view.error &&
      ["queued", "running", "waiting_for_answer", "waiting"].includes(
        view.task?.state ?? "",
      )
    )
      timer = setTimeout(() => {
        void refresh();
      }, 2000);
  };
  const failure = (error: unknown) => {
    if (!current()) return;
    if (error instanceof SavedTaskHttpError && error.status === 401) {
      publish({ task: null, error: error.message, signedOut: true });
      adapters.expiredSession();
    } else
      publish({
        ...(error instanceof SavedTaskHttpError &&
        [404, 410].includes(error.status)
          ? { task: null, expired: error.status === 410 }
          : {}),
        error:
          error instanceof SavedTaskHttpError
            ? error.message
            : "Could not update the saved task. Retry to check its progress.",
      });
  };
  async function run(operation: () => Promise<TaskRecord>) {
    if (!current() || view.busy || view.signedOut) return;
    clearTimeout(timer);
    publish({ busy: true, error: null });
    try {
      const task = await operation();
      if (!current()) return;
      publish({ task });
    } catch (error) {
      failure(error);
    } finally {
      publish({ busy: false });
      schedule();
    }
  }
  const refresh = () =>
    run(async () => {
      if (!reference) return adapters.recover(signal);
      return adapters.read(reference, signal);
    });
  const act = (action: SavedTaskAction) =>
    run(async () => {
      if (!view.task) throw new Error("Load the task before changing it.");
      // Refresh before each command, including a retry after a lost response.
      const latest = await adapters.read(
        {
          ownerId: view.task.ownerId,
          projectId: view.task.input.projectId,
          taskId: view.task.id,
        },
        signal,
      );
      if (!current()) throw new DOMException("Session ended", "AbortError");
      publish({ task: latest });
      if (action.kind === "answer") {
        const question = latest.questions.find(
          (item) => item.id === action.questionId,
        );
        if (question?.answer) {
          if (
            question.answer.operationId === action.operationId &&
            question.answer.value === action.value
          )
            return latest;
          throw new SavedTaskHttpError(409);
        }
        if (savedTaskStatus(latest).question?.id !== action.questionId)
          throw new SavedTaskHttpError(409);
      } else if (action.kind === "stop" && latest.state === "stopped")
        return latest;
      else if (action.kind === "resume" && latest.state !== "failed")
        return latest;
      return adapters.change(latest, action, signal);
    });
  return {
    start: refresh,
    retry: refresh,
    stop: () => act({ kind: "stop" }),
    resume: () => act({ kind: "resume" }),
    answer(questionId: string, value: string) {
      if (!answer || answer.questionId !== questionId || answer.value !== value)
        answer = {
          kind: "answer",
          questionId,
          value,
          operationId: adapters.operationId(),
        };
      return act(answer);
    },
    dispose() {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
