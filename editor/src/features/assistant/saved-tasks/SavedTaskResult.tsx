import { useEffect, useRef, useState } from "react";
import type { TaskRecord } from "../../../../../packages/pvo-assistant/tasks/index.js";
import { SavedTaskHttpError } from "../../../infrastructure/assistant/savedTaskTransport";
import { useAssistantScope } from "../../../state/assistant/sessionScope";
import {
  refreshAccountSession,
  useAuthGate,
} from "../../../state/auth/authGateStore";
import { useCapture } from "../../../state/captureStore";
import { TaskResultSaveError } from "./applicationWorkflow";
import { applySavedTaskResult } from "./applicationCommands";
import styles from "./SavedTaskPanel.module.css";

export function SavedTaskResult({ task }: { task: TaskRecord }) {
  const epoch = useAssistantScope((state) => state.epoch);
  const phase = useAuthGate((state) => state.phase);
  const applied = useCapture((state) =>
    Boolean(
      state.assistantTaskLinks?.applied?.some(
        (item) => item.ownerId === task.ownerId && item.taskId === task.id,
      ),
    ),
  );
  const identity = `${epoch}:${phase}:${task.id}`;
  const [view, setView] = useState({ identity, busy: false, error: "" });
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [identity],
  );
  const current =
    view.identity === identity ? view : { busy: false, error: "" };
  async function apply() {
    if (controller.current && !controller.current.signal.aborted) return;
    const attempt = new AbortController();
    controller.current = attempt;
    setView({ identity, busy: true, error: "" });
    try {
      await applySavedTaskResult(
        {
          ownerId: task.ownerId,
          projectId: task.input.projectId,
          taskId: task.id,
        },
        attempt.signal,
      );
      if (!attempt.signal.aborted)
        setView({ identity, busy: false, error: "" });
    } catch (error) {
      if (attempt.signal.aborted) return;
      if (error instanceof SavedTaskHttpError && error.status === 401)
        void refreshAccountSession();
      setView({
        identity,
        busy: false,
        error:
          error instanceof TaskResultSaveError
            ? ""
            : error instanceof Error
              ? error.message
              : "The saved result could not be applied.",
      });
    } finally {
      if (controller.current === attempt) controller.current = null;
    }
  }
  return (
    <div className={styles.actions}>
      {current.error && <p role="alert">{current.error}</p>}
      {applied ? (
        <p>Applied to this draft. You can use Undo.</p>
      ) : (
        <button
          type="button"
          disabled={current.busy || phase !== "ready"}
          onClick={() => {
            void apply();
          }}
        >
          {current.busy ? "Applying…" : "Apply result"}
        </button>
      )}
    </div>
  );
}
