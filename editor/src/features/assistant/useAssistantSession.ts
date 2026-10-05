import { useEffect, useMemo, useRef } from "react";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { assistantFailureNotification } from "../../domain/assistant/failure";
import {
  resetAssistant,
  useAssistant,
} from "../../state/assistant/assistantStore";
import { setAssistantThreadOpen } from "../../state/assistant/threadStore";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import { useCapture } from "../../state/captureStore";
import { projectSnapshot } from "../../state/project/history";
import {
  clearNotificationScope,
  notify,
  type NotificationId,
} from "../../state/notifications/notificationStore";
import { createAssistantSessionRequest } from "./assistantSessionRequest";
import type { VoiceFailure } from "./voice/voiceFailure";

const voiceNotifications: Record<VoiceFailure["reason"], NotificationId> = {
  holdShort: "voiceHoldShort",
  unavailable: "voiceUnavailable",
  denied: "voiceDenied",
  noMicrophone: "voiceNoMicrophone",
  noSpeech: "voiceNoSpeech",
  network: "voiceNetwork",
  failed: "voiceFailed",
};

/** Every orb request uses the native planner; validated edits apply once with guarded Undo. */
export function useAssistantSession({
  inspectorVisible = false,
}: { inspectorVisible?: boolean } = {}) {
  const state = useAssistant();
  const capture = useCapture();
  const scopeEpoch = useAssistantScope((scope) => scope.epoch);
  const target =
    capture.components.find((component) => component.id === capture.selComp) ??
    null;
  const inspector = useRef(inspectorVisible);
  inspector.current = inspectorVisible;
  const sheetAllows = (sheet: typeof capture.sheet) =>
    !sheet || (inspector.current && sheet === "component");
  const available =
    capture.screen === "editor" &&
    !capture.tryMode &&
    !capture.recording &&
    !capture.importing &&
    capture.ex !== "running" &&
    !capture.playheadPick &&
    sheetAllows(capture.sheet);
  const activeScope = useRef(scopeEpoch);
  const voiceContext = useMemo(
    () =>
      `${scopeEpoch}:${capture.localId}:${nativeProjectFingerprint(projectSnapshot(capture))}`,
    [
      capture.localId,
      scopeEpoch,
      capture.scenes,
      capture.currentSceneId,
      capture.ratio,
      capture.allowedDomains,
    ],
  );
  const voiceOrigin = useRef<"idle" | "typing">("idle");
  const playback = useRef<{ sceneId: string; playing: boolean } | null>(null);
  const operation = useRef(0);

  const pause = () => {
    const current = useCapture.getState();
    playback.current ??= {
      sceneId: current.currentSceneId,
      playing: current.playing,
    };
    current.patch({ playing: false, orb: false, ratioMenu: false });
  };
  const restorePlayback = () => {
    const previous = playback.current;
    playback.current = null;
    const current = useCapture.getState();
    if (
      previous?.playing &&
      current.currentSceneId === previous.sceneId &&
      current.screen === "editor" &&
      !current.tryMode &&
      !current.playheadPick &&
      sheetAllows(current.sheet)
    )
      current.patch({ playing: true });
  };
  const report = (error: unknown, name: string) => {
    const detail =
      error instanceof Error
        ? error.message
        : "The assistant could not complete this request.";
    useAssistant.setState({ failureDetail: { operation: name, detail } });
    notify(
      /project changed/i.test(detail)
        ? "assistantProjectChanged"
        : assistantFailureNotification(error),
      {
        scope: "assistant",
        operation: `${name}:${++operation.current}`,
        currentAttempt: true,
      },
    );
  };
  const workflow = useMemo(
    () =>
      createAssistantSessionRequest({
        pause,
        restorePlayback,
        releasePlayback: () => {
          playback.current = null;
        },
        report,
        nextOperation: () => ++operation.current,
      }),
    [],
  );
  useEffect(
    () => () => {
      workflow.cancel();
      resetAssistant();
      clearNotificationScope("assistant");
      restorePlayback();
    },
    [],
  );
  useEffect(() => {
    const changedScope = activeScope.current !== scopeEpoch;
    if (!available || changedScope) {
      workflow.cancel();
      setAssistantThreadOpen(false);
      resetAssistant({ preserveConversation: !changedScope });
      playback.current = null;
    }
    activeScope.current = scopeEpoch;
  }, [available, scopeEpoch]);
  const open = () => {
    if (!available || state.phase === "review") return;
    pause();
    clearNotificationScope("assistant");
    useAssistant.setState({
      phase: "typing",
      failureDetail: null,
      transcript: "",
    });
  };
  const stop = () => {
    workflow.cancel();
    useAssistant.setState({
      phase: "typing",
      transcript: "",
      progress: "",
      answer: null,
    });
  };
  const close = () => {
    if (useAssistant.getState().phase === "review") return;
    stop();
    clearNotificationScope("assistant");
    useAssistant.setState({ phase: "idle", answer: null });
    restorePlayback();
  };

  const submit = async (words: string) => {
    const prior = useAssistant.getState();
    if (!available || prior.phase === "working") return;
    await workflow.submit({
      prompt: words,
      history: prior.history,
      evidence: prior.evidence,
    });
  };
  const acknowledge = () => {
    if (!useAssistant.getState().answer) return;
    useAssistant.setState({ phase: "idle", answer: null });
    clearNotificationScope("assistant");
    restorePlayback();
  };
  const editRequest = () => {
    const answer = useAssistant.getState().answer;
    if (answer)
      useAssistant.setState({
        phase: "typing",
        draft: answer.request,
        answer: null,
      });
  };
  const suggestions = target
    ? ["Softer colours", "Larger heading", "Bolder"]
    : ["Explain this", "Refine this", "Check the result"];
  return {
    ...state,
    target,
    available,
    voiceContext,
    suggestions,
    open,
    close,
    stop,
    submit,
    acknowledge,
    editRequest,
    voiceSide:
      voiceOrigin.current === "typing" ? ("left" as const) : ("right" as const),
    setDraft: (draft: string) => useAssistant.setState({ draft }),
    listen: (transcript: string) => {
      const phase = useAssistant.getState().phase;
      if (phase === "idle" || phase === "typing") voiceOrigin.current = phase;
      pause();
      useAssistant.setState({
        phase: "listening",
        transcript,
        failureDetail: null,
      });
    },
    cancelVoice: () => {
      if (useAssistant.getState().phase !== "listening") return;
      useAssistant.setState({ phase: voiceOrigin.current, transcript: "" });
      if (voiceOrigin.current === "idle") restorePlayback();
    },
    reportVoiceFailure: (failure: VoiceFailure) => {
      useAssistant.setState({
        failureDetail: { operation: "voice", detail: failure.detail },
      });
      notify(
        failure.serviceError
          ? assistantFailureNotification(failure.serviceError)
          : voiceNotifications[failure.reason],
        {
          scope: "assistant",
          operation: `voice:${++operation.current}`,
          currentAttempt: true,
        },
      );
    },
  };
}
