import { dur } from "../../domain/clips/timing";
import { trimClip } from "../../domain/clips/trim";
import type { Clip, TextOverlay } from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import { dragTextTiming } from "../../domain/text/timing";
import { useCapture } from "../captureStore";

export function previewClipTrim(
  original: Clip,
  index: number,
  side: "l" | "r",
  deltaSeconds: number,
  firstUpdate: boolean,
  pixelsPerSecond: number,
) {
  const state = useCapture.getState();
  if (firstUpdate) state.edit({});
  const clip = trimClip(original, side, deltaSeconds);
  const clips = useCapture
    .getState()
    .clips.map((item, i) => (i === index ? clip : item));
  state.patch({
    clips,
    trim: {
      i: index,
      side,
      shift: side === "l" ? (dur(original) - dur(clip)) * pixelsPerSecond : 0,
      lt: side === "l" ? clip.in : Math.max(clip.in, clip.out - 0.04),
    },
  });
}

export function previewTextTiming(
  id: number,
  original: Pick<TextOverlay, "start" | "end">,
  mode: "move" | "l" | "r",
  deltaSeconds: number,
  firstUpdate: boolean,
) {
  const state = useCapture.getState();
  if (firstUpdate) state.edit({});
  state.updateText(
    id,
    dragTextTiming(original, mode, deltaSeconds),
    false,
    { preservePlayhead: true },
  );
}

/** Finish a mobile text gesture after its live frames kept the snap target still. */
export function finishTextTimingPreview() {
  const state = useCapture.getState();
  const t = clamp(state.t, 0, sceneDuration(state));
  state.patch({ t, ...(t === state.t ? {} : { playing: false }) });
}
