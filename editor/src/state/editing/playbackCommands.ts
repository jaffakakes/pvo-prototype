import { sceneDuration } from "../../domain/scenes/duration";
import { clamp } from "../../domain/project/numbers";
import { useCapture } from "../captureStore";

export function togglePlayback() {
  const state = useCapture.getState();
  if (state.tryMode?.holdingId || state.playheadPick) return;
  const playing = !state.playing;
  state.patch({
    playing,
    t: state.t >= sceneDuration(state) ? 0 : state.t,
    tryMode: state.tryMode ? { ...state.tryMode, playing } : null,
  });
}

export function scrubPlayback(time: number) {
  const state = useCapture.getState();
  if (state.tryMode?.holdingId) return;
  state.patch({ t: clamp(time, 0, sceneDuration(state)), playing: false,
    tryMode: state.tryMode ? { ...state.tryMode, playing: false } : null });
}
