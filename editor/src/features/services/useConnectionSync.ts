import { useEffect } from "react";
import { saveProjectBeforeUpdate } from "../../app/projectAutosave";
import { projectConnectionReport } from "../../domain/services/connectionReports";
import { listServices } from "../../infrastructure/services/client";
import {
  readContainerConnections,
  sendContainerConnections,
} from "../../infrastructure/services/connections";
import { useAuthGate } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import { useConnectionSync } from "../../state/services/connectionSync";
import { syncProjectConnections } from "./connectionSyncWorkflow";

function capture() {
  const project = useCapture.getState(),
    owner = useAuthGate.getState();
  if (owner.phase !== "ready") return null;
  return projectConnectionReport(
    project,
    project.assistantTaskLinks,
    project.localId,
    owner.user?.id ?? null,
    project.projectName || "Untitled edit",
  );
}
/** Application lifetime, independent of the Containers panel. No workshop, generated code or publication runs here. */
export function useProjectConnectionSync() {
  useCapture((state) => state.scenes);
  useCapture((state) => state.assistantTaskLinks);
  useCapture((state) => state.projectName);
  useAuthGate((state) => state.phase);
  const scope = useAssistantScope();
  const retry = useConnectionSync((state) => state.retry);
  let encoded: string | null = null,
    error: string | null = null;
  try {
    const report = capture();
    encoded = report ? JSON.stringify(report) : null;
  } catch (failure) {
    error =
      failure instanceof Error
        ? failure.message
        : "Couldn’t read project connections.";
  }
  const key = `${scope.ownerId}:${scope.localId}:${scope.epoch}`;
  useEffect(() => {
    const controller = new AbortController();
    useConnectionSync.setState({
      scope: key,
      phase: error ? "failed" : encoded ? "pending" : "idle",
      error,
    });
    if (!encoded || error) return () => controller.abort();
    const report = JSON.parse(encoded) as NonNullable<
      ReturnType<typeof capture>
    >;
    const current = () => {
      try {
        return (
          !controller.signal.aborted &&
          useAssistantScope.getState().epoch === scope.epoch &&
          JSON.stringify(capture()) === encoded
        );
      } catch {
        return false;
      }
    };
    const timer = window.setTimeout(() => {
      void syncProjectConnections(
        report,
        {
          flush: saveProjectBeforeUpdate,
          list: listServices,
          read: readContainerConnections,
          send: sendContainerConnections,
        },
        { signal: controller.signal, isCurrent: current },
      )
        .then(() => {
          if (current())
            useConnectionSync.setState({
              scope: key,
              phase: "saved",
              error: null,
            });
        })
        .catch((failure) => {
          if (current())
            useConnectionSync.setState({
              scope: key,
              phase: "failed",
              error:
                failure instanceof Error
                  ? failure.message
                  : "Connection reporting paused. Retry when online.",
            });
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, scope.epoch, encoded, error, retry]);
}
