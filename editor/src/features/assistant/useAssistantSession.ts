import { useEffect, useRef } from "react";
import { assistantReviewRequest, assistantSource, createAssistantReview, matchesAssistantTarget } from "../../domain/assistant/review";
import { validateAssistantContext } from "../../domain/assistant/context";
import { assistantFailureNotification } from "../../domain/assistant/failure";
import { assistantRequestContext } from "../../domain/assistant/requestContext";
import { validateAssistantEditingMode } from "../../domain/assistant/editingMode";
import { total } from "../../domain/clips/timing";
import { collectRequestDomains } from "../../domain/components/actions";
import { cloneComponent } from "../../domain/project/snapshot";
import { createAssistantService } from "../../infrastructure/assistant/service";
import { resetAssistant, useAssistant } from "../../state/assistant/assistantStore";
import { useCapture } from "../../state/captureStore";
import { keepAssistantReview } from "../../state/assistant/assistantCommands";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import { clearNotificationScope, notify, type NotificationId } from "../../state/notifications/notificationStore";
import type { VoiceFailure } from "./voice/browserRecognition";

const service = createAssistantService();
const voiceNotifications: Record<VoiceFailure["reason"], NotificationId> = {
  holdShort: "voiceHoldShort", unavailable: "voiceUnavailable", denied: "voiceDenied",
  noMicrophone: "voiceNoMicrophone", noSpeech: "voiceNoSpeech", network: "voiceNetwork", failed: "voiceFailed",
};

export function useAssistantSession({ inspectorVisible = false }: { inspectorVisible?: boolean } = {}) {
  const state = useAssistant();
  const advanced = useEditorPreferences(state => state.advancedEditingEnabled);
  const capture = useCapture();
  const target = capture.components.find(component => component.id === capture.selComp) ?? null;
  const sheetAllowsAssistant = (sheet: typeof capture.sheet) => !sheet || (inspectorVisible && sheet === "component");
  const available = !capture.tryMode && sheetAllowsAssistant(capture.sheet) && !capture.playheadPick;
  const request = useRef<AbortController | null>(null);
  const operationCount = useRef(0);
  const voiceOrigin = useRef<"idle" | "typing">("idle");
  const playback = useRef<{ sceneId: string; playing: boolean } | null>(null);
  const targetKey = `${capture.currentSceneId}:${target?.id ?? ""}`;
  const notificationScope = `assistant:${targetKey}`;

  const pausePlayback = () => {
    const current = useCapture.getState();
    if (!playback.current) playback.current = { sceneId: current.currentSceneId, playing: current.playing };
    current.patch({ playing: false, orb: false, ratioMenu: false });
  };
  const restorePlayback = () => {
    const previous = playback.current;
    playback.current = null;
    const current = useCapture.getState();
    if (previous?.playing && current.currentSceneId === previous.sceneId && current.screen === "editor"
      && !current.tryMode && sheetAllowsAssistant(current.sheet) && !current.playheadPick) current.patch({ playing: true });
  };

  useEffect(() => {
    request.current?.abort();
    resetAssistant();
    return () => {
      request.current?.abort();
      clearNotificationScope(notificationScope);
      restorePlayback();
      resetAssistant();
    };
  }, [notificationScope, available]);

  const report = (id: NotificationId, operation: string, detail: string) => {
    useAssistant.setState({ failureDetail: { operation, detail } });
    notify(id, { scope: notificationScope, operation: `${operation}:${++operationCount.current}`, currentAttempt: true });
  };
  useEffect(() => {
    if (!state.review || advanced) return;
    try { validateAssistantEditingMode(state.review, false); }
    catch (error) {
      request.current?.abort();
      const draft = state.phase === "working" ? `${assistantReviewRequest(state.review)}; ${state.draft}` : assistantReviewRequest(state.review);
      useAssistant.setState({ phase: "typing", draft, review: null, before: false });
      report(assistantFailureNotification(error), "mode", "The pending proposal requires Advanced editing.");
    }
  }, [advanced, state.review]);
  const stillAvailable = (sceneId: string, componentId: string) => {
    const latest = useCapture.getState();
    return latest.currentSceneId === sceneId && latest.selComp === componentId
      && !latest.tryMode && sheetAllowsAssistant(latest.sheet) && !latest.playheadPick;
  };
  const stale = (operation: string) => {
    useAssistant.setState({ phase: "typing", review: null, before: false });
    report("assistantStale", operation, "The selected component changed before the proposal could be applied.");
  };
  const open = () => {
    if (!available) return;
    if (!target) { report("assistantNoTarget", "open", "Select a component before opening the assistant."); return; }
    pausePlayback();
    clearNotificationScope(notificationScope);
    useAssistant.setState({ phase: "typing", failureDetail: null, transcript: "" });
  };
  const close = () => {
    const current = useAssistant.getState();
    if (current.phase === "working" || current.phase === "review") return;
    request.current?.abort();
    clearNotificationScope(notificationScope);
    useAssistant.setState({ phase: "idle", transcript: "", failureDetail: null, before: false });
    restorePlayback();
  };
  const submit = async (words: string) => {
    const prompt = words.trim();
    const prior = useAssistant.getState();
    const current = useCapture.getState();
    const selected = current.components.find(component => component.id === current.selComp);
    if (!prompt || !selected || !available || prior.phase === "working") return;
    const original = prior.review?.original ?? cloneComponent(selected);
    if (!matchesAssistantTarget(original, selected)) {
      stale("request"); return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const sceneId = current.currentSceneId;
    const originalRequest = prior.review?.request ?? prompt;
    const tags = prior.review ? [...prior.review.tags, prompt] : [];
    pausePlayback();
    clearNotificationScope(notificationScope);
    useAssistant.setState({ phase: "working", draft: prompt, transcript: "", failureDetail: null, before: false });
    try {
      const context = assistantRequestContext(sceneId, total(current.clips), current.scenes);
      const proposal = await service.propose({ componentType: selected.type,
        editingMode: useEditorPreferences.getState().advancedEditingEnabled ? "advanced" : "no-code",
        source: assistantSource(prior.review?.proposed ?? selected), prompt,
        ...(context ? { context } : {}) }, { signal: controller.signal });
      if (controller.signal.aborted || !stillAvailable(sceneId, original.id)) return;
      const latest = useCapture.getState();
      if (!matchesAssistantTarget(original, latest.components.find(component => component.id === original.id))) {
        stale("request"); return;
      }
      validateAssistantContext(proposal.compiled, {
        sceneIds: latest.scenes.filter(scene => scene.clips.length).map(scene => scene.id), duration: total(latest.clips),
        requestDomains: collectRequestDomains(latest.scenes, latest.allowedDomains),
      });
      const review = createAssistantReview(original, proposal, originalRequest, tags, prior.review?.skipped);
      validateAssistantEditingMode(review, useEditorPreferences.getState().advancedEditingEnabled);
      useAssistant.setState({ phase: "review", review, draft: assistantReviewRequest(review) });
    } catch (error) {
      if (controller.signal.aborted || !stillAvailable(sceneId, original.id)) return;
      useAssistant.setState({ phase: prior.review ? "review" : "typing",
        draft: prior.review ? assistantReviewRequest(prior.review) : prompt });
      report(assistantFailureNotification(error),
        "request", error instanceof Error ? error.message : "The PVO proposal could not be prepared.");
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  const keep = () => {
    const review = useAssistant.getState().review;
    if (!review) return;
    try {
      if (!keepAssistantReview(review)) {
        stale("keep"); return;
      }
      clearNotificationScope(notificationScope);
      resetAssistant();
      restorePlayback();
    } catch (error) {
      report(assistantFailureNotification(error), "keep", error instanceof Error ? error.message : "The PVO change could not be saved.");
    }
  };
  const editRequest = () => {
    const review = useAssistant.getState().review;
    if (!review || useAssistant.getState().phase === "working") return;
    clearNotificationScope(notificationScope);
    useAssistant.setState({ phase: "typing", draft: assistantReviewRequest(review), review: null,
      before: false, failureDetail: null, transcript: "" });
  };
  return {
    ...state, target, available, modeLabel: service.label, open, close, submit, keep, editRequest,
    reportVoiceFailure: (failure: VoiceFailure) => {
      if (target && stillAvailable(capture.currentSceneId, target.id))
        report(voiceNotifications[failure.reason], "voice", failure.detail);
    },
    setDraft: (draft: string) => useAssistant.setState({ draft }),
    listen: (transcript: string) => {
      const phase = useAssistant.getState().phase;
      if (phase === "idle" || phase === "typing") voiceOrigin.current = phase;
      pausePlayback();
      clearNotificationScope(notificationScope);
      useAssistant.setState({ phase: "listening", transcript, failureDetail: null });
    },
    cancelVoice: () => {
      if (useAssistant.getState().phase !== "listening") return;
      useAssistant.setState({ phase: voiceOrigin.current, transcript: "" });
      if (voiceOrigin.current === "idle") restorePlayback();
    },
    undo: editRequest,
    showBefore: (before: boolean) => useAssistant.setState({ before }),
  };
}
