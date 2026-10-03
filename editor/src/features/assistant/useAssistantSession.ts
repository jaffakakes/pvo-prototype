import { useEffect, useMemo, useRef } from "react";
import { compilePvoComponent } from "../../../../packages/pvo-language/index.js";
import { prepareNativeBatch, validateNativeBatchEditingMode, validateNativeBatchEffects } from "../../domain/assistant/native/batch";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { assistantFailureNotification, AssistantServiceError } from "../../domain/assistant/failure";
import { readNativeAvailability, requestNativeTurn } from "../../infrastructure/assistant/nativeTransport";
import { runNativeTask } from "../../infrastructure/assistant/runNativeTask";
import { assistantFailureReason, createAssistantTrace } from "../../infrastructure/assistant/taskDiagnostics";
import { inspectAssistantFrames } from "../../infrastructure/assistant/media/frames";
import { transcribeAssistantAudio } from "../../infrastructure/assistant/media/transcript";
import { alignAssistantWords } from "../../infrastructure/assistant/media/wordTiming";
import { trackAssistantObject, TrackingSelectionError } from "../../infrastructure/assistant/media/objectTracking";
import { uid } from "../../infrastructure/ids";
import { applyAssistantChanges } from "../../state/assistant/applyChanges";
import { notifyAssistantApplied } from "../../state/assistant/nativeAppliedNotification";
import { resetAssistant, useAssistant } from "../../state/assistant/assistantStore";
import { useCapture } from "../../state/captureStore";
import { projectSnapshot } from "../../state/project/history";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import { clearNotificationScope, notify, type NotificationId } from "../../state/notifications/notificationStore";
import type { VoiceFailure } from "./voice/voiceFailure";
import { inspectWebTool, isWebObservationRequest, prepareAssistantFonts } from "../../infrastructure/assistant/webTools";
import { readSavedFonts } from "../../infrastructure/fonts/library";
import { obtainLibraryFont, saveLibraryFont } from "../../state/fonts/fontLibraryStore";

const voiceNotifications: Record<VoiceFailure["reason"], NotificationId> = {
  holdShort: "voiceHoldShort", unavailable: "voiceUnavailable", denied: "voiceDenied",
  noMicrophone: "voiceNoMicrophone", noSpeech: "voiceNoSpeech", network: "voiceNetwork", failed: "voiceFailed",
};

/** Every orb request uses the native planner; validated edits apply once with guarded Undo. */
export function useAssistantSession({ inspectorVisible = false }: { inspectorVisible?: boolean } = {}) {
  const state = useAssistant();
  const capture = useCapture();
  const target = capture.components.find(component => component.id === capture.selComp) ?? null;
  const sheetAllows = (sheet: typeof capture.sheet) => !sheet || (inspectorVisible && sheet === "component");
  const available = capture.screen === "editor" && !capture.tryMode && !capture.recording && !capture.importing
    && capture.ex !== "running" && !capture.playheadPick && sheetAllows(capture.sheet);
  const request = useRef<AbortController | null>(null);
  const projectId = useRef(capture.localId);
  const voiceContext = useMemo(() => `${capture.localId}:${nativeProjectFingerprint(projectSnapshot(capture))}`,
    [capture.localId, capture.scenes, capture.currentSceneId, capture.ratio, capture.allowedDomains]);
  const voiceOrigin = useRef<"idle" | "typing">("idle");
  const playback = useRef<{ sceneId: string; playing: boolean } | null>(null);
  const operation = useRef(0);

  const pause = () => {
    const current = useCapture.getState();
    playback.current ??= { sceneId: current.currentSceneId, playing: current.playing };
    current.patch({ playing: false, orb: false, ratioMenu: false });
  };
  const restorePlayback = () => {
    const previous = playback.current;
    playback.current = null;
    const current = useCapture.getState();
    if (previous?.playing && current.currentSceneId === previous.sceneId && current.screen === "editor"
      && !current.tryMode && !current.playheadPick && sheetAllows(current.sheet)) current.patch({ playing: true });
  };
  useEffect(() => () => {
    request.current?.abort();
    resetAssistant();
    clearNotificationScope("assistant");
    restorePlayback();
  }, []);
  useEffect(() => {
    const changedProject = projectId.current !== null && projectId.current !== capture.localId;
    if (!available || changedProject) {
      request.current?.abort();
      request.current = null;
      resetAssistant({ preserveConversation: !changedProject });
      playback.current = null;
    }
    projectId.current = capture.localId;
  }, [available, capture.localId]);
  const report = (error: unknown, name: string) => {
    const detail = error instanceof Error ? error.message : "The assistant could not complete this request.";
    useAssistant.setState({ failureDetail: { operation: name, detail } });
    notify(/project changed/i.test(detail) ? "assistantProjectChanged" : assistantFailureNotification(error),
      { scope: "assistant", operation: `${name}:${++operation.current}`, currentAttempt: true });
  };
  const open = () => {
    if (!available || state.phase === "review") return;
    pause();
    clearNotificationScope("assistant");
    useAssistant.setState({ phase: "typing", failureDetail: null, transcript: "" });
  };
  const stop = () => {
    request.current?.abort();
    request.current = null;
    useAssistant.setState({ phase: "typing", transcript: "", progress: "", answer: null });
  };
  const close = () => {
    if (useAssistant.getState().phase === "review") return;
    stop();
    clearNotificationScope("assistant");
    useAssistant.setState({ phase: "idle", answer: null });
    restorePlayback();
  };

  const submit = async (words: string) => {
    const prompt = words.trim();
    const prior = useAssistant.getState();
    if (!prompt || !available || prior.phase === "working" || request.current) return;
    const live = useCapture.getState();
    const original = projectSnapshot(live);
    const originalFingerprint = nativeProjectFingerprint(original);
    const localId = live.localId;
    const assertCurrent = () => {
      const latest = useCapture.getState();
      if ((localId !== null && latest.localId !== localId)
        || nativeProjectFingerprint(projectSnapshot(latest)) !== originalFingerprint)
        throw new Error("The project changed while the assistant was working. Please ask again.");
    };
    try { assertCurrent(); } catch (error) { report(error, "request"); return; }
    const pending = new AbortController();
    request.current = pending;
    let message = "";
    const observations: string[] = [];
    const trace = createAssistantTrace();
    let applying = false;
    try {
      let availability;
      try { availability = await readNativeAvailability(pending.signal); }
      catch {
        pending.signal.throwIfAborted();
        throw new AssistantServiceError(503);
      }
      if (!availability.available || !availability.capabilities.editing) throw new AssistantServiceError(503);
      pause();
      useAssistant.setState({ phase: "working", draft: prompt, transcript: "", progress: "", failureDetail: null });
      clearNotificationScope("assistant");
      const result = await runNativeTask({ prompt, mode: "plan", history: prior.history, evidence: prior.evidence }, {
        trace,
        snapshot: () => original,
        playhead: () => useCapture.getState().t,
        selection: () => ({ clipId: live.clips[live.sel]?.id ?? null, textId: live.selText,
          componentId: live.selComp, audioId: live.selAudio }),
        turn: async (input, signal) => {
          assertCurrent();
          const response = await requestNativeTurn(input, signal);
          assertCurrent();
          return response;
        },
        observe: async (project, observation, signal) => {
          if (isWebObservationRequest(observation)) {
            const result = await inspectWebTool(observation, signal, { list: readSavedFonts, save: saveLibraryFont });
            assertCurrent();
            return result;
          }
          let result;
          try {
            switch (observation.kind) {
              case "frames": result = await inspectAssistantFrames(project, observation, { signal }); break;
              case "transcript": result = await transcribeAssistantAudio(project, observation, { signal }); break;
              case "word_timing": result = await alignAssistantWords(project, observation, { signal }); break;
              case "object_tracking": result = await trackAssistantObject(project, observation, { signal }); break;
            }
          } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AssistantServiceError && error.status === 429) throw error;
            result = { kind: "unavailable" as const, sceneId: observation.sceneId, requestedKind: observation.kind,
              message: error instanceof TrackingSelectionError ? error.message
                : "This media section could not be inspected. Do not guess its contents." };
          }
          assertCurrent();
          return result;
        },
        prepare: async (project, operations, signal, trackingEvidence) => prepareNativeBatch(project, operations, {
          fonts: await prepareAssistantFonts(operations, signal, obtainLibraryFont),
          createId: uid, compile: compilePvoComponent, signal,
          advancedEditingEnabled: useEditorPreferences.getState().advancedEditingEnabled,
          trackingEvidence,
        }),
        commit: () => { throw new Error("Prepare a complete validated batch before applying changes."); },
        progress: progress => useAssistant.setState({ progress }),
        report: event => {
          if (event.observation) observations.push(event.message);
          else message = event.message;
        },
      }, pending.signal);
      pending.signal.throwIfAborted();
      assertCurrent();
      const { batch: planned, history, evidence } = result;
      const answer = { request: prompt, message: result.answer ?? message, observations };
      if (planned) {
        applying = true;
        trace({ stage: "application", status: "started" });
        validateNativeBatchEffects(planned);
        validateNativeBatchEditingMode(planned, useEditorPreferences.getState().advancedEditingEnabled);
        const applied = applyAssistantChanges(planned);
        trace({ stage: "application", status: "completed", changed: Boolean(applied) });
        applying = false;
        if (!applied && !planned.playback.length && !planned.exportFormat) {
          useAssistant.setState({ phase: "review", progress: "", answer, history, evidence });
          return;
        }
        if (planned.playback.length) playback.current = null;
        useAssistant.setState({ phase: result.answer ? "review" : "idle", answer: result.answer ? answer : null, progress: "", draft: "",
          evidence, history: [...history, { role: "assistant" as const,
            content: "The editor completed the validated operations. Use the current project for any follow-up." }].slice(-12) });
        clearNotificationScope("assistant");
        if (!result.answer) restorePlayback();
        if (applied) notifyAssistantApplied(applied, planned.operations, `apply:${++operation.current}`);
      } else {
        useAssistant.setState({ phase: "review", progress: "", answer, history, evidence });
      }
    } catch (error) {
      if (applying) trace({ stage: "application", status: "failed", reason: assistantFailureReason(error) });
      if (!pending.signal.aborted) {
        useAssistant.setState({ phase: prior.answer ? "review" : "typing", draft: prompt, progress: "" });
        report(error, "request");
      }
    } finally { if (request.current === pending) request.current = null; }
  };
  const acknowledge = () => {
    if (!useAssistant.getState().answer) return;
    useAssistant.setState({ phase: "idle", answer: null });
    clearNotificationScope("assistant");
    restorePlayback();
  };
  const editRequest = () => {
    const answer = useAssistant.getState().answer;
    if (answer) useAssistant.setState({ phase: "typing", draft: answer.request, answer: null });
  };
  const suggestions = target ? ["Softer colours", "Larger heading", "Bolder"] : ["Explain this", "Refine this", "Check the result"];
  return { ...state, target, available, voiceContext, suggestions, open, close, stop, submit, acknowledge, editRequest,
    voiceSide: voiceOrigin.current === "typing" ? "left" as const : "right" as const,
    setDraft: (draft: string) => useAssistant.setState({ draft }),
    listen: (transcript: string) => {
      const phase = useAssistant.getState().phase;
      if (phase === "idle" || phase === "typing") voiceOrigin.current = phase;
      pause();
      useAssistant.setState({ phase: "listening", transcript, failureDetail: null });
    },
    cancelVoice: () => {
      if (useAssistant.getState().phase !== "listening") return;
      useAssistant.setState({ phase: voiceOrigin.current, transcript: "" });
      if (voiceOrigin.current === "idle") restorePlayback();
    },
    reportVoiceFailure: (failure: VoiceFailure) => {
      useAssistant.setState({ failureDetail: { operation: "voice", detail: failure.detail } });
      notify(failure.serviceError ? assistantFailureNotification(failure.serviceError) : voiceNotifications[failure.reason], {
        scope: "assistant", operation: `voice:${++operation.current}`, currentAttempt: true,
      });
    },
  };
}
