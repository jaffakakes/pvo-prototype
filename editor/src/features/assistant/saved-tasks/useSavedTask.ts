import { saveProjectBeforeUpdate } from "../../../app/projectAutosave";
import {
  beginTaskLinkRequest,
  discardExpiredTaskSubmission,
} from "../../../state/assistant/taskProjectCommands";
import { useEffect, useRef, useState } from "react";
import {
  ownedPendingTask,
  ownedTaskReference,
} from "../../../domain/assistant/taskProjectLink";
import {
  changeSavedTask,
  readSavedTask,
} from "../../../infrastructure/assistant/savedTaskTransport";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { useAssistantScope } from "../../../state/assistant/sessionScope";
import {
  refreshAccountSession,
  useAuthGate,
} from "../../../state/auth/authGateStore";
import { useCapture } from "../../../state/captureStore";
import { savedTaskCreation } from "./creationCommands";
import { createSavedTaskSession, type SavedTaskView } from "./taskSession";

const empty: SavedTaskView = {
  task: null,
  busy: true,
  error: null,
  signedOut: false,
  expired: false,
};

export function useSavedTask() {
  const scope = useAssistantScope();
  const links = useCapture((state) => state.assistantTaskLinks);
  const authPhase = useAuthGate((state) => state.phase);
  const creating = useAssistant((state) => state.phase === "working");
  const pending = ownedPendingTask(links, scope.localId, scope.ownerId);
  const reference = ownedTaskReference(links, scope.localId, scope.ownerId);
  const identity = `${scope.epoch}:${pending?.input.operationId ?? reference?.taskId ?? ""}:${authPhase}`;
  const [result, setResult] = useState<{
    identity: string;
    view: SavedTaskView;
  } | null>(null);
  const session = useRef<ReturnType<typeof createSavedTaskSession> | null>(
    null,
  );

  useEffect(() => {
    if (
      authPhase !== "ready" ||
      !scope.ownerId ||
      (!pending && !reference) ||
      (pending && creating)
    )
      return;
    const current = () =>
      useAssistantScope.getState().epoch === scope.epoch &&
      useCapture.getState().assistantTaskLinks === links &&
      useAuthGate.getState().phase === "ready";
    const instance = createSavedTaskSession(pending ? null : reference, {
      current,
      read: readSavedTask,
      change: changeSavedTask,
      recover: savedTaskCreation.recover,
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
      instance.dispose();
      if (session.current === instance) session.current = null;
    };
  }, [identity, links, creating]);

  // Render-time scope check hides old private data before an effect cleanup runs.
  const view: SavedTaskView =
    authPhase === "ready" && !scope.ownerId
      ? {
          ...empty,
          busy: false,
          signedOut: true,
          error: "Sign in to open this project's saved tasks.",
        }
      : result?.identity === identity
        ? result.view
        : empty;
  return {
    ...view,
    pending: Boolean(pending),
    clearExpired: () => {
      if (
        !view.expired ||
        !pending ||
        useAssistantScope.getState().epoch !== scope.epoch
      )
        return;
      discardExpiredTaskSubmission(
        beginTaskLinkRequest(),
        pending.input.operationId,
      );
      // The project save surface retains and reports any local write failure.
      void saveProjectBeforeUpdate().catch(() => {});
    },
    retry: () => {
      void session.current?.retry();
    },
    stop: () => {
      void session.current?.stop();
    },
    resume: () => {
      void session.current?.resume();
    },
    answer: (questionId: string, value: string) =>
      session.current?.answer(questionId, value),
  };
}
