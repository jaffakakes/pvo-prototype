import { useEffect, useRef, useState } from "react";
import {
  parseTaskInput,
  type TaskRecord,
} from "../../../../packages/pvo-assistant/tasks/index.js";
import type { ServiceDraft } from "../../../../packages/pvo-assistant/services/index.js";
import {
  SavedTaskHttpError,
  createSavedTask,
  readSavedTask,
  changeSavedTask,
} from "../../infrastructure/assistant/savedTaskTransport";
import {
  readDraftTaskLink,
  saveDraftTaskLink,
  type DraftTaskLink,
} from "../../infrastructure/services/draftTasks";
import {
  useAuthGate,
  refreshAccountSession,
} from "../../state/auth/authGateStore";
import {
  createSavedTaskSession,
  type SavedTaskView,
} from "../assistant/saved-tasks/taskSession";

const empty: SavedTaskView = {
  task: null,
  busy: false,
  error: null,
  signedOut: false,
  expired: false,
};
/** Container-specific task selection; execution, questions and retries use the existing saved-task session. */
export function useContainerTask(ownerId: string, serviceId: string) {
  const [link, setLink] = useState<DraftTaskLink | null>(null);
  const [loaded, setLoaded] = useState("");
  const [creationConflict, setCreationConflict] = useState("");
  const [result, setResult] = useState<{
    identity: string;
    view: SavedTaskView;
  } | null>(null);
  const session = useRef<ReturnType<typeof createSavedTaskSession> | null>(
    null,
  );
  const scope = `${ownerId}:${serviceId}`;
  const identity = `${scope}:${link?.input.operationId ?? ""}`;
  useEffect(() => {
    setLink(null);
    setResult(null);
    setLoaded("");
    try {
      setLink(readDraftTaskLink(ownerId, serviceId));
      setLoaded(scope);
    } catch (error) {
      setResult({
        identity: `${scope}:`,
        view: {
          ...empty,
          error:
            error instanceof Error
              ? error.message
              : "Couldn’t read the saved editing task.",
        },
      });
    }
  }, [scope]);
  useEffect(() => {
    if (loaded !== scope || !link) return;
    let disposed = false;
    const current = () =>
      !disposed && useAuthGate.getState().user?.id === ownerId;
    const check = (task: TaskRecord) => {
      if (
        task.ownerId !== ownerId ||
        task.input.projectId !== link.input.projectId ||
        !("container" in task.input.context) ||
        task.input.context.container.serviceId !== serviceId
      )
        throw new Error("This task does not belong to this Container.");
      return task;
    };
    const instance = createSavedTaskSession(link.reference, {
      current,
      read: async (ref, signal) => {
        try {
          return check(await readSavedTask(ref, signal));
        } catch (error) {
          if (error instanceof SavedTaskHttpError && error.status === 404)
            throw new SavedTaskHttpError(410);
          throw error;
        }
      },
      change: changeSavedTask,
      recover: async (signal) => {
        if (current()) setCreationConflict("");
        let task: TaskRecord;
        try {
          task = check(await createSavedTask(link.input, signal));
        } catch (error) {
          if (
            current() &&
            !link.reference &&
            error instanceof SavedTaskHttpError &&
            error.status === 409
          )
            setCreationConflict(identity);
          throw error;
        }
        if (!current())
          throw new DOMException("Editing session ended", "AbortError");
        const next = {
          ...link,
          reference: {
            ownerId,
            projectId: task.input.projectId,
            taskId: task.id,
          },
        };
        saveDraftTaskLink(ownerId, serviceId, next);
        setLink(next);
        return task;
      },
      publish: (view) => setResult({ identity, view }),
      expiredSession: () => {
        void refreshAccountSession();
      },
      operationId: () => crypto.randomUUID(),
      now: Date.now,
    });
    session.current = instance;
    void instance.start();
    return () => {
      disposed = true;
      instance.dispose();
      if (session.current === instance) session.current = null;
    };
  }, [identity, loaded, link?.reference?.taskId]);
  const view =
    result?.identity === identity && useAuthGate.getState().user?.id === ownerId
      ? result.view
      : empty;
  const start = (
    draft: ServiceDraft,
    request: string,
    mode: "edit" | "test" | "repair",
  ) => {
    if (loaded !== scope || useAuthGate.getState().user?.id !== ownerId) return;
    if (link && (!view.task || !["ready", "stopped"].includes(view.task.state)))
      return;
    try {
      const input = parseTaskInput({
        operationId: crypto.randomUUID(),
        projectId: draft.identity.projectId,
        request: request.trim(),
        examples: [],
        context: {
          fingerprint: `draft-${serviceId}-${draft.revision}`,
          container: { serviceId, revision: draft.revision, mode },
        },
      });
      const next = { input, reference: null };
      saveDraftTaskLink(ownerId, serviceId, next);
      setLink(next);
    } catch (error) {
      setResult({
        identity,
        view: {
          ...view,
          error:
            error instanceof Error
              ? error.message
              : "Couldn’t save this request.",
        },
      });
    }
  };
  return {
    ...view,
    start,
    creationConflict: creationConflict === identity && !link?.reference,
    clearCreationConflict: () => {
      if (
        creationConflict !== identity ||
        link?.reference ||
        view.busy ||
        useAuthGate.getState().user?.id !== ownerId
      )
        return;
      try {
        saveDraftTaskLink(ownerId, serviceId, null);
        setLink(null);
        setResult(null);
        setCreationConflict("");
      } catch {
        setResult({
          identity,
          view: {
            ...view,
            error:
              "Couldn’t clear this unstarted request. Retry after restoring browser storage.",
          },
        });
      }
    },
    clearExpired: () => {
      if (!view.expired || useAuthGate.getState().user?.id !== ownerId) return;
      try {
        saveDraftTaskLink(ownerId, serviceId, null);
        setLink(null);
        setResult(null);
      } catch {
        setResult({
          identity,
          view: {
            ...view,
            error:
              "Couldn’t clear the expired task link. Restore browser storage and retry.",
          },
        });
      }
    },
    pending: !!link && !view.task && !view.error,
    canStart:
      loaded === scope &&
      (!link ||
        (!!view.task && ["ready", "stopped"].includes(view.task.state))),
    retry: () => void session.current?.retry(),
    stop: () => void session.current?.stop(),
    resume: () => void session.current?.resume(),
    answer: (id: string, value: string) =>
      void session.current?.answer(id, value),
  };
}
