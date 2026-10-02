import type { NativePlaybackOperation } from "../../domain/assistant/native/batch";
import { useCapture } from "../captureStore";
import { scrubPlayback, togglePlayback } from "../editing/playbackCommands";

/** Native preview operations use the same transport commands as keyboard and toolbar. */
export function applyNativePlayback(operations: readonly NativePlaybackOperation[]) {
  for (const operation of operations) {
    const state = useCapture.getState();
    if (operation.kind === "playback.seek") {
      if (state.currentSceneId !== operation.sceneId) state.switchScene(operation.sceneId, { undoable: false });
      scrubPlayback(operation.time);
    } else if (state.playing !== (operation.kind === "playback.play")) {
      togglePlayback();
    }
  }
}
