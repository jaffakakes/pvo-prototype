import { dur } from "../../domain/clips/timing";
import { trimClip } from "../../domain/clips/trim";
import type { Clip, TextOverlay } from "../../domain/project/model";
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
  sceneLength: number,
  firstUpdate: boolean,
) {
  const state = useCapture.getState();
  if (firstUpdate) state.edit({});
  state.updateText(
    id,
    dragTextTiming(original, mode, deltaSeconds, sceneLength),
    false,
  );
}
