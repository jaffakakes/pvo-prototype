import { useCapture } from "../captureStore";
import { assistantFocused, useAssistant } from "../assistant/assistantStore";

/** Use the panel's normal dismissal before returning to the main tools. */
export async function clearSelection(
  dismissPanel?: () => void | Promise<void>,
) {
  const state = useCapture.getState();
  if (
    state.playheadPick ||
    state.tryMode ||
    assistantFocused(useAssistant.getState())
  )
    return;
  const closing = state.sheet ? dismissPanel?.() : undefined;
  if (closing) await closing;
  const current = useCapture.getState();
  // Nested panels and confirmations may deliberately keep the sheet open.
  // A close animation must not clear a different selection made while it ran.
  if (
    current.sheet ||
    current.playheadPick ||
    current.tryMode ||
    assistantFocused(useAssistant.getState()) ||
    (closing &&
      (current.localId !== state.localId ||
        current.currentSceneId !== state.currentSceneId ||
        current.sel !== state.sel ||
        current.selComp !== state.selComp ||
        current.selText !== state.selText ||
        current.selAudio !== state.selAudio))
  )
    return;
  current.patch({
    sel: -1,
    selComp: null,
    selText: null,
    selAudio: null,
    orb: false,
  });
}
