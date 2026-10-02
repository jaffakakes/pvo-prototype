import { create } from "zustand";
import { assistantExchangeResult, type AssistantExchange, type AssistantExchangeInput } from "../../domain/assistant/thread";
import { assistantPatchMatches, createAssistantThreadPatch } from "../../domain/assistant/threadPatch";
import { assistantReviewRequest, type AssistantReview } from "../../domain/assistant/review";
import { useCapture } from "../captureStore";

type AssistantThreadState = {
  projectId: string | null;
  items: AssistantExchange[];
  open: boolean;
  collapsed: boolean;
  draft: string;
};

const empty = (projectId: string | null): AssistantThreadState => ({
  projectId, items: [], open: false, collapsed: false, draft: "",
});

// Exchanges belong to the active session, never a saved project or its history.
export const useAssistantThread = create<AssistantThreadState>(() => empty(useCapture.getState().localId));
export const resetAssistantThread = () => useAssistantThread.setState(empty(useCapture.getState().localId));
export const setAssistantThreadOpen = (open: boolean) => {
  if (open) useCapture.getState().patch({ playing: false });
  useAssistantThread.setState({ open });
};
export const setAssistantThreadDraft = (draft: string) => useAssistantThread.setState({ draft });
export const setAssistantThreadCollapsed = (collapsed: boolean) => useAssistantThread.setState({ collapsed });

function updateExchange(id: string, update: (item: AssistantExchange) => AssistantExchange) {
  useAssistantThread.setState(state => ({ items: state.items.map(item => item.id === id ? update(item) : item) }));
}

export function startAssistantExchange(input: AssistantExchangeInput): string {
  const id = crypto.randomUUID();
  const item: AssistantExchange = {
    id, at: input.at, kind: input.kind ?? "ask", you: input.request,
    label: input.label, color: input.color, orb: "Working on it…", changes: [],
    status: "pending", pending: true, undone: false,
    targets: input.target ? [{ ...input.target }] : [],
  };
  useAssistantThread.setState(state => ({ items: [...state.items, item], draft: "" }));
  return id;
}

export function refineAssistantExchange(id: string, request: string) {
  updateExchange(id, item => ({
    ...item, you: request, status: "pending", pending: true, orb: "Working on it…", error: undefined,
  }));
}

export function proposeAssistantExchange(id: string, review: AssistantReview) {
  updateExchange(id, item => ({
    ...item, ...assistantExchangeResult(review), you: assistantReviewRequest(review),
    status: "proposed", pending: false, error: undefined,
  }));
}

/** Called after Keep succeeds, so the inverse records the actual committed values. */
export function applyAssistantExchange(id: string, review: AssistantReview): boolean {
  const current = useCapture.getState().scenes.find(scene => scene.id === review.original.sceneId)
    ?.components.find(component => component.id === review.original.id);
  if (!current || !useAssistantThread.getState().items.some(item => item.id === id)) return false;
  const patch = createAssistantThreadPatch(review.original, current);
  updateExchange(id, item => ({
    ...item, ...assistantExchangeResult(review), status: "applied", pending: false,
    undone: false, patch, error: undefined,
  }));
  return true;
}

export function finishAssistantExchange(id: string, status: "failed" | "cancelled", message: string) {
  updateExchange(id, item => ({ ...item, status, pending: false, orb: message, changes: [], error: undefined }));
}

export function setAssistantExchangeError(id: string, error?: string) {
  updateExchange(id, item => ({ ...item, error }));
}

useCapture.subscribe((state, previous) => {
  const resetEmptyProject = state.scenes !== previous.scenes && !state.past.length && !state.future.length
    && state.scenes.every(scene => !scene.clips.length && !scene.components.length && !scene.texts.length)
    && previous.scenes.some(scene => scene.clips.length || scene.components.length || scene.texts.length);
  if (state.localId !== previous.localId || resetEmptyProject) {
    resetAssistantThread();
    return;
  }
  if (state.scenes === previous.scenes) return;
  const thread = useAssistantThread.getState();
  let changed = false;
  const items = thread.items.map(item => {
    if (item.status !== "applied" || !item.patch) return item;
    const component = state.scenes.find(scene => scene.id === item.patch?.sceneId)
      ?.components.find(candidate => candidate.id === item.patch?.componentId);
    const undone = assistantPatchMatches(component, item.patch, "before") ? true
      : assistantPatchMatches(component, item.patch, "after") ? false : item.undone;
    if (undone === item.undone) return item;
    changed = true;
    return { ...item, undone, error: undefined };
  });
  if (changed) useAssistantThread.setState({ items });
});
