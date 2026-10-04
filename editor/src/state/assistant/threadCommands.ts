import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import type { AssistantThreadTarget } from "../../domain/assistant/thread";
import { dur } from "../../domain/clips/timing";
import { useCapture } from "../captureStore";
import { dismissNotification, useNotifications } from "../notifications/notificationStore";
import { projectSnapshot } from "../project/history";
import type { CaptureState } from "../types";
import { useAssistant } from "./assistantStore";
import { getAssistantThreadReceipt, type AssistantThreadHistoryGuard, useAssistantThread } from "./threadStore";

export type AssistantThreadCommandResult = { ok: boolean; message?: string };
export type AssistantThreadActionAvailability = {
  canUndo: boolean;
  canRedo: boolean;
  canShow: boolean;
  message?: string;
};

function unavailable(message: string): AssistantThreadCommandResult {
  return { ok: false, message };
}

function editorBlocked(state: CaptureState): boolean {
  return state.screen !== "editor" || state.recording || state.importing || !!state.trim
    || !!state.tryMode || !!state.playheadPick || state.ex === "running"
    || useAssistant.getState().phase === "working" || useAssistant.getState().phase === "listening";
}

function guardMatches(state: CaptureState, guard: AssistantThreadHistoryGuard,
  localId: CaptureState["localId"]): boolean {
  return state.localId === localId && state.past === guard.past && state.future === guard.future
    && nativeProjectFingerprint(projectSnapshot(state)) === guard.fingerprint;
}

function targetExists(state: CaptureState, target: AssistantThreadTarget): boolean {
  const scene = state.scenes.find(item => item.id === target.sceneId);
  if (!scene) return false;
  switch (target.kind) {
    case "component": return scene.components.some(item => item.id === target.id);
    case "clip": return scene.clips.some(item => item.id === target.id);
    case "text": return scene.texts.some(item => item.id === target.id);
    case "audio": return (scene.audioClips ?? []).some(item => item.id === target.id);
  }
}

/** Only the exact top project-history state for this exchange may be toggled. */
export function assistantThreadActionAvailability(id: string): AssistantThreadActionAvailability {
  const thread = useAssistantThread.getState();
  const item = thread.items.find(exchange => exchange.id === id);
  if (!item) return { canUndo: false, canRedo: false, canShow: false,
    message: "This exchange is no longer available." };
  const state = useCapture.getState();
  if (thread.projectId !== state.localId || editorBlocked(state)) return {
    canUndo: false, canRedo: false, canShow: false, message: "Finish the current operation first.",
  };
  const target = item.target;
  const canShow = !!target && targetExists(state, target);
  const receipt = getAssistantThreadReceipt(id);
  const guard = item.undone ? receipt?.before : receipt?.after;
  const canToggle = item.status === "applied" && !!receipt && !!guard
    && guardMatches(state, guard, receipt.change.localId)
    && (item.undone ? state.future.length > 0 : state.past.length > 0);
  return {
    canUndo: canToggle && !item.undone,
    canRedo: canToggle && item.undone,
    canShow,
    message: !canToggle && item.status === "applied" ? "A later edit changed the project history."
      : target && !canShow ? "This item is no longer in the project." : undefined,
  };
}

function appendHistory(content: string) {
  useAssistant.setState(state => ({ history: [...state.history,
    { role: "assistant" as const, content }].slice(-12) }));
}

export function undoAssistantThreadExchange(id: string): AssistantThreadCommandResult {
  const available = assistantThreadActionAvailability(id);
  if (!available.canUndo) return unavailable(available.message ?? "This edit cannot be undone here.");
  useCapture.getState().undo();
  if (useNotifications.getState().current?.id === "assistantApplied") dismissNotification();
  appendHistory("The user undid the previous assistant edit. Use the current project for the next request.");
  return { ok: true };
}

export function redoAssistantThreadExchange(id: string): AssistantThreadCommandResult {
  const available = assistantThreadActionAvailability(id);
  if (!available.canRedo) return unavailable(available.message ?? "This edit cannot be redone here.");
  useCapture.getState().redo();
  appendHistory("The user redid the previous assistant edit. Use the current project for the next request.");
  return { ok: true };
}

/** Showing the originally selected target is navigation and never changes undo history. */
export function showAssistantThreadExchange(id: string): AssistantThreadCommandResult {
  const available = assistantThreadActionAvailability(id);
  if (!available.canShow) return unavailable(available.message ?? "This item is no longer in the project.");
  const target = useAssistantThread.getState().items.find(item => item.id === id)?.target;
  if (!target) return unavailable("This exchange has no selected item.");
  const state = useCapture.getState();
  const scene = state.scenes.find(item => item.id === target.sceneId);
  if (!scene) return unavailable("This scene is no longer in the project.");
  const selection: Partial<CaptureState> = {
    currentSceneId: target.sceneId, sel: -1, selComp: null, selText: null, selAudio: null,
    t: 0, playing: false, trim: null, sheet: null,
  };
  switch (target.kind) {
    case "component": {
      const component = scene.components.find(item => item.id === target.id);
      if (!component) return unavailable("This component is no longer in the project.");
      selection.selComp = component.id;
      selection.t = component.at;
      break;
    }
    case "clip": {
      const index = scene.clips.findIndex(item => item.id === target.id);
      if (index < 0) return unavailable("This clip is no longer in the project.");
      selection.sel = index;
      selection.t = scene.clips.slice(0, index).reduce((time, clip) => time + dur(clip), 0);
      break;
    }
    case "text": {
      const text = scene.texts.find(item => item.id === target.id);
      if (!text) return unavailable("This text is no longer in the project.");
      selection.selText = text.id;
      selection.t = text.start;
      break;
    }
    case "audio": {
      const audio = scene.audioClips?.find(item => item.id === target.id);
      if (!audio) return unavailable("This audio is no longer in the project.");
      selection.selAudio = audio.id;
      selection.t = audio.start;
      break;
    }
  }
  state.patch(selection);
  return { ok: true };
}
