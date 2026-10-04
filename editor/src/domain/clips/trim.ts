import type { Clip } from "../project/model";
import { clamp } from "../project/numbers";

/** Delta is expressed in timeline seconds, before clip playback speed. */
export function trimClip(
  clip: Clip,
  side: "l" | "r",
  deltaSeconds: number,
  minimumSeconds = 0.3,
): Clip {
  const delta = deltaSeconds * clip.speed;
  const minimum = minimumSeconds * clip.speed;
  return side === "l"
    ? { ...clip, in: clamp(clip.in + delta, 0, clip.out - minimum) }
    : { ...clip, out: clamp(clip.out + delta, clip.in + minimum, clip.srcDur) };
}

/** Timeline handles use tenths unless an exact snap target is supplied. */
export function trimClipHandle(
  clip: Clip,
  side: "l" | "r",
  deltaSeconds: number,
  exact = false,
  minimumSeconds = 0.5,
) {
  const duration = (clip.out - clip.in) / clip.speed;
  const adjusted = exact ? deltaSeconds : Math.round(deltaSeconds * 10) / 10;
  if (adjusted === 0) return clip;
  // A preexisting short segment may grow, but the handle must not silently
  // lengthen it or shorten it further just to meet the normal minimum.
  return trimClip(clip, side, adjusted, Math.min(duration, minimumSeconds));
}
