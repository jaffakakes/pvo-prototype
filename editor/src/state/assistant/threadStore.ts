import { create } from "zustand";
import {
  ASSISTANT_THREAD_LIMIT, assistantThreadText,
  type AssistantExchange, type AssistantThreadTarget,
} from "../../domain/assistant/thread";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";
import type { CaptureState } from "../types";
import type { AppliedAssistantChange } from "./applyChanges";

type ThreadState = {
  projectId: CaptureState["localId"];
  items: AssistantExchange[];
  open: boolean;
  collapsed: boolean;
};

export type AssistantThreadHistoryGuard = {
  past: CaptureState["past"];
  future: CaptureState["future"];
  fingerprint: string;
};

export type AssistantThreadReceipt = {
  change: AppliedAssistantChange;
  beforeFingerprint: string;
  after: AssistantThreadHistoryGuard;
  before: AssistantThreadHistoryGuard | null;
};

const receipts = new Map<string, AssistantThreadReceipt>();
const empty = (projectId: CaptureState["localId"]): ThreadState => ({
  projectId, items: [], open: false, collapsed: false,
});

/** Visible conversation is session-only; the assistant store still owns the composer draft. */
export const useAssistantThread = create<ThreadState>(() => empty(useCapture.getState().localId));

export function resetAssistantThread() {
  receipts.clear();
  useAssistantThread.setState(empty(useCapture.getState().localId));
}

export function setAssistantThreadOpen(open: boolean) {
  useAssistantThread.setState({ open });
}

export function setAssistantThreadCollapsed(collapsed: boolean) {
  useAssistantThread.setState({ collapsed });
}

function selectedTarget(state: CaptureState): AssistantThreadTarget | null {
  const sceneId = state.currentSceneId;
  const component = state.components.find(item => item.id === state.selComp);
  if (component) return { kind: "component", sceneId, id: component.id,
    label: `${component.type[0].toUpperCase()}${component.type.slice(1)}` };
  const text = state.texts.find(item => item.id === state.selText);
  if (text) return { kind: "text", sceneId, id: text.id, label: "Text" };
  const audio = state.audioClips.find(item => item.id === state.selAudio);
  if (audio) return { kind: "audio", sceneId, id: audio.id, label: audio.name || "Audio" };
  const clip = state.clips[state.sel];
  if (clip) return { kind: "clip", sceneId, id: clip.id, label: `Clip ${state.sel + 1}` };
  return null;
}

function updateExchange(id: string, update: (item: AssistantExchange) => AssistantExchange) {
  useAssistantThread.setState(state => ({
    items: state.items.map(item => item.id === id ? update(item) : item),
  }));
}

export function startAssistantExchange(request: string): string {
  const capture = useCapture.getState();
  if (useAssistantThread.getState().projectId !== capture.localId) resetAssistantThread();
  const id = crypto.randomUUID();
  const item: AssistantExchange = {
    id, at: capture.t, request: assistantThreadText(request, 2000), status: "pending",
    response: "", progress: "", summary: "", target: selectedTarget(capture), undone: false,
  };
  useAssistantThread.setState(state => {
    const items = [...state.items, item].slice(-ASSISTANT_THREAD_LIMIT);
    const retained = new Set(items.map(exchange => exchange.id));
    for (const key of receipts.keys()) if (!retained.has(key)) receipts.delete(key);
    return { items };
  });
  return id;
}

export function updateAssistantExchangeProgress(id: string, progress: string) {
  updateExchange(id, item => item.status === "pending"
    ? { ...item, progress: assistantThreadText(progress, 200) } : item);
}

export function completeAssistantExchange(id: string, result: {
  response?: string;
  summary?: string;
  change?: AppliedAssistantChange | null;
}) {
  const item = useAssistantThread.getState().items.find(exchange => exchange.id === id);
  if (!item || item.status !== "pending") return;
  const before = result.change?.past.at(-1);
  if (result.change && before) {
    receipts.set(id, { change: result.change, beforeFingerprint: nativeProjectFingerprint(before),
      after: { past: result.change.past, future: result.change.future, fingerprint: result.change.fingerprint },
      before: null });
  }
  updateExchange(id, current => ({ ...current, status: result.change && before ? "applied" : "answered",
    response: assistantThreadText(result.response ?? ""),
    summary: assistantThreadText(result.summary ?? "", 160), progress: "", undone: false }));
}

export function finishAssistantExchange(id: string, status: "failed" | "cancelled", message = "") {
  updateExchange(id, item => item.status === "pending" ? { ...item, status,
    response: assistantThreadText(message, 1000), progress: "" } : item);
}

export function getAssistantThreadReceipt(id: string): AssistantThreadReceipt | null {
  return receipts.get(id) ?? null;
}

export function markAssistantThreadHistoryState(id: string, undone: boolean, state: CaptureState) {
  const receipt = receipts.get(id);
  if (!receipt) return;
  const guard = { past: state.past, future: state.future,
    fingerprint: undone ? receipt.beforeFingerprint : receipt.change.fingerprint };
  if (undone) receipt.before = guard;
  else receipt.after = guard;
  updateExchange(id, item => item.status === "applied" ? { ...item, undone } : item);
}

function matchesHistory(state: CaptureState, guard: AssistantThreadHistoryGuard,
  localId: CaptureState["localId"]): boolean {
  return state.localId === localId && state.past === guard.past && state.future === guard.future
    && nativeProjectFingerprint(projectSnapshot(state)) === guard.fingerprint;
}

// Ordinary editor Undo/Redo and the short-lived applied notification keep the row in sync.
useCapture.subscribe((state, previous) => {
  if (state.localId !== previous.localId
    || (previous.screen === "editor" && state.screen === "camera"
      && !state.past.length && !state.future.length && state.scenes.every(scene =>
        !scene.clips.length && !scene.texts.length && !scene.components.length))) {
    resetAssistantThread();
    return;
  }
  if (state.past === previous.past && state.future === previous.future) return;
  for (const item of useAssistantThread.getState().items) {
    if (item.status !== "applied") continue;
    const receipt = receipts.get(item.id);
    if (!receipt) continue;
    const guard = item.undone ? receipt.before : receipt.after;
    if (!guard || !matchesHistory(previous, guard, receipt.change.localId)) continue;
    const fingerprint = nativeProjectFingerprint(projectSnapshot(state));
    if (!item.undone && state.past.length === previous.past.length - 1
      && state.future.length === previous.future.length + 1
      && fingerprint === receipt.beforeFingerprint
      && nativeProjectFingerprint(state.future[0]) === receipt.change.fingerprint) {
      markAssistantThreadHistoryState(item.id, true, state);
    } else if (item.undone && state.past.length === previous.past.length + 1
      && state.future.length === previous.future.length - 1
      && fingerprint === receipt.change.fingerprint) {
      markAssistantThreadHistoryState(item.id, false, state);
    }
  }
});
