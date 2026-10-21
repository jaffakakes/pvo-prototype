import { useCapture } from "../captureStore";
import { assistantFocused, useAssistant } from "../assistant/assistantStore";

/** Use the panel's normal dismissal before returning to the main tools. */
export function clearSelection(dismissPanel?: () => void) {
  const state = useCapture.getState();
  if (state.playheadPick || state.tryMode || assistantFocused(useAssistant.getState())) return;
  if (state.sheet) dismissPanel?.();
  // Nested panels and confirmations may deliberately keep the sheet open.
  if (useCapture.getState().sheet) return;
  state.patch({ sel: -1, selComp: null, selText: null, selAudio: null, orb: false });
}
