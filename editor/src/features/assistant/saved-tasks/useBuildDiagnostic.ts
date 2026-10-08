import { useEffect, useState } from "react";
import type { TaskRecord } from "../../../../../packages/pvo-assistant/tasks/index.js";
import type { BuildDiagnostic } from "../../../domain/assistant/buildDiagnostics";
import {
  readBuildDiagnostic,
  SavedTaskHttpError,
} from "../../../infrastructure/assistant/savedTaskTransport";
import { useAssistantScope } from "../../../state/assistant/sessionScope";
import {
  refreshAccountSession,
  useAuthGate,
} from "../../../state/auth/authGateStore";

export function useBuildDiagnostic(task: TaskRecord) {
  const scope = useAssistantScope();
  const phase = useAuthGate((state) => state.phase);
  const [open, setOpen] = useState(false);
  const identity = `${scope.epoch}:${phase}:${task.id}:${task.revision}`;
  const [result, setResult] = useState<{
    identity: string;
    data: BuildDiagnostic | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!open || phase !== "ready" || scope.ownerId !== task.ownerId) return;
    const controller = new AbortController();
    const reference = {
      ownerId: task.ownerId,
      projectId: task.input.projectId,
      taskId: task.id,
    };
    void readBuildDiagnostic(reference, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ identity, data, error: "" });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof SavedTaskHttpError && error.status === 401)
          void refreshAccountSession();
        setResult({
          identity,
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Build details could not be opened.",
        });
      });
    return () => controller.abort();
  }, [
    open,
    identity,
    task.id,
    task.ownerId,
    task.input.projectId,
    scope.ownerId,
    phase,
  ]);
  return {
    setOpen,
    busy: open && result?.identity !== identity,
    data:
      phase === "ready" &&
      scope.ownerId === task.ownerId &&
      result?.identity === identity
        ? result.data
        : null,
    error: result?.identity === identity ? result.error : "",
  };
}
