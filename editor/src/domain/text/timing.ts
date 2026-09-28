import type { TextOverlay } from "../project/model";
import { clamp } from "../project/numbers";

type Timing = Pick<TextOverlay, "start" | "end">;

export function dragTextTiming(
  timing: Timing,
  mode: "move" | "l" | "r",
  deltaSeconds: number,
  sceneLength: number,
): Partial<Timing> {
  if (mode === "move") {
    const span = Math.min(sceneLength, timing.end - timing.start);
    const start = clamp(
      timing.start + deltaSeconds,
      0,
      Math.max(0, sceneLength - span),
    );
    return { start, end: start + span };
  }
  return mode === "l"
    ? textTimingAt(timing, "start", timing.start + deltaSeconds, sceneLength)
    : textTimingAt(timing, "end", timing.end + deltaSeconds, sceneLength);
}

export function textTimingAt(
  timing: Timing,
  edge: "start" | "end",
  seconds: number,
  sceneLength: number,
): Partial<Timing> {
  return edge === "start"
    ? { start: clamp(seconds, 0, timing.end - 0.1) }
    : { end: clamp(seconds, timing.start + 0.1, sceneLength) };
}
