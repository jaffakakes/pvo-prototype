import type { TextOverlay } from "../project/model";
import { clamp } from "../project/numbers";

type Timing = Pick<TextOverlay, "start" | "end">;

export function dragTextTiming(
  timing: Timing,
  mode: "move" | "l" | "r",
  deltaSeconds: number,
): Partial<Timing> {
  if (mode === "move") {
    const span = Math.max(0.1, timing.end - timing.start);
    const start = Math.max(0, timing.start + deltaSeconds);
    return { start, end: start + span };
  }
  return mode === "l"
    ? textTimingAt(timing, "start", timing.start + deltaSeconds)
    : textTimingAt(timing, "end", timing.end + deltaSeconds);
}

export function textTimingAt(
  timing: Timing,
  edge: "start" | "end",
  seconds: number,
): Partial<Timing> {
  return edge === "start"
    ? { start: clamp(seconds, 0, timing.end - 0.1) }
    : { end: Math.max(timing.start + 0.1, seconds) };
}
