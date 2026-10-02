import { collectRequestDomains } from "../../domain/components/actions";
import { componentLanguageModel } from "../../domain/components/languageEditing";
import { validateAssistantContext } from "../../domain/assistant/context";
import type { AssistantExchange } from "../../domain/assistant/thread";
import { applyAssistantThreadPatch, assistantPatchMatches } from "../../domain/assistant/threadPatch";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../captureStore";
import { setAssistantExchangeError, setAssistantThreadOpen, useAssistantThread } from "./threadStore";
import { useAssistant } from "./assistantStore";
import { clearNotificationScope } from "../notifications/notificationStore";

export type AssistantThreadCommandResult = { ok: boolean; message?: string };

/** Close buttons, Escape, outside taps and sheet dragging share this transition. */
export function dismissAssistantThread() {
  const assistant = useAssistant.getState();
  if (assistant.phase === "review") return;
  setAssistantThreadOpen(false);
  if (assistant.phase === "working") return;
  const capture = useCapture.getState();
  clearNotificationScope(`assistant:${capture.localId}:${capture.currentSceneId}:${capture.selComp ?? ""}`);
  useAssistant.setState({ phase: "idle", transcript: "", failureDetail: null, before: false });
}

function unavailable(message: string): AssistantThreadCommandResult {
  return { ok: false, message };
}

export function assistantExchangeAvailability(item: AssistantExchange) {
  const state = useCapture.getState();
  const target = item.targets[0];
  const component = target && state.scenes.find(scene => scene.id === target.sceneId)
    ?.components.find(candidate => candidate.id === target.componentId);
  const blocked = state.recording || state.importing || state.ex === "running" || !!state.tryMode || !!state.playheadPick;
  let message: string | undefined;
  if (blocked) message = "Finish the current operation first.";
  else if (!component) message = "This component is no longer in the project.";
  else if (item.status === "applied" && item.patch
    && !assistantPatchMatches(component, item.patch, item.undone ? "before" : "after")) {
    message = "This change overlaps a later edit. Undo that edit first.";
  }
  const canToggle = !message && item.status === "applied" && !!item.patch?.changes.length;
  return { canUndo: canToggle && !item.undone, canRedo: canToggle && item.undone, canShow: !blocked && !!component, message };
}

/** Inverse patches make an older exchange one atomic edit without rolling back its neighbors. */
export function toggleAssistantExchange(id: string): AssistantThreadCommandResult {
  const item = useAssistantThread.getState().items.find(exchange => exchange.id === id);
  if (!item?.patch) return unavailable("This exchange has no saved edit.");
  const availability = assistantExchangeAvailability(item);
  if (!availability.canUndo && !availability.canRedo) {
    const result = unavailable(availability.message ?? "This exchange has no saved edit.");
    setAssistantExchangeError(id, result.message);
    return result;
  }
  const state = useCapture.getState();
  const scene = state.scenes.find(candidate => candidate.id === item.patch?.sceneId)!;
  const component = scene.components.find(candidate => candidate.id === item.patch?.componentId)!;
  const next = applyAssistantThreadPatch(component, item.patch, item.undone ? "redo" : "undo");
  if (!next) return unavailable("This change overlaps a later edit. Undo that edit first.");
  try {
    validateAssistantContext(componentLanguageModel(next), {
      sceneIds: state.scenes.filter(candidate => candidate.clips.length).map(candidate => candidate.id),
      duration: sceneDuration(scene), requestDomains: collectRequestDomains(state.scenes, state.allowedDomains),
    });
  } catch {
    const message = "This edit no longer matches the project's scenes or destinations.";
    setAssistantExchangeError(id, message);
    return unavailable(message);
  }
  state.edit({
    scenes: state.scenes.map(candidate => candidate.id !== scene.id ? candidate : {
      ...candidate, components: candidate.components.map(value => value.id === component.id ? next : value),
    }),
    playing: false,
  });
  setAssistantExchangeError(id);
  return { ok: true };
}

/** Selection navigation is outside history and preserves the current redo branch. */
export function showAssistantExchange(id: string): AssistantThreadCommandResult {
  const item = useAssistantThread.getState().items.find(exchange => exchange.id === id);
  if (!item) return unavailable("This exchange is no longer available.");
  const availability = assistantExchangeAvailability(item);
  if (!availability.canShow) return unavailable(availability.message ?? "This component is no longer in the project.");
  const target = item.targets[0];
  const state = useCapture.getState();
  const component = state.scenes.find(scene => scene.id === target.sceneId)!
    .components.find(candidate => candidate.id === target.componentId)!;
  state.patch({
    currentSceneId: target.sceneId, sel: -1, selComp: component.id, selText: null, selAudio: null,
    t: component.at, playing: false, trim: null, sheet: null,
  });
  return { ok: true };
}
