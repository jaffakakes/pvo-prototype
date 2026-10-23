import { adjustClip, resetClipFraming } from "../../domain/clips/adjustments";
import type { Clip } from "../../domain/project/model";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../captureStore";

export function adjustSelectedClip(values: Partial<Clip>, undoable = true) {
  const state = useCapture.getState();
  if (!state.clips[state.sel]) return false;
  const clips = state.clips.map((clip, index) =>
    index === state.sel ? adjustClip(clip, values) : clip,
  );
  if (undoable) state.edit({ clips });
  else state.patch({ clips });
  return true;
}

export function setSelectedClipSpeed(speed: number, undoable = true) {
  if (!adjustSelectedClip({ speed }, undoable)) return;
  const state = useCapture.getState();
  state.patch({ t: Math.min(state.t, sceneDuration(state)) });
}

export function setSelectedClipFraming(
  fit: Clip["fit"],
  resetAppearance = false,
) {
  const state = useCapture.getState();
  const clip = state.clips[state.sel];
  if (!clip) return;
  state.edit({
    clips: state.clips.map((item) =>
      item.id === clip.id ? resetClipFraming(item, fit, resetAppearance) : item,
    ),
  });
}
