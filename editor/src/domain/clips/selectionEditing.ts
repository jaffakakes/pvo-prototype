import type { Clip } from "../project/model";
import { dur, total } from "./timing";

export function selectedClipRange(clips: Clip[], index: number) {
  const clip = clips[index];
  if (!clip) return null;
  const start = total(clips.slice(0, index));
  return { clip, start, end: start + dur(clip) };
}

/** Desktop split targets the selection, falling back to its midpoint. */
export function selectedSplitTime(
  clips: Clip[],
  index: number,
  playhead: number,
) {
  const range = selectedClipRange(clips, index);
  if (!range || dur(range.clip) < 0.4) return null;
  return playhead - range.start >= 0.2 && range.end - playhead >= 0.2
    ? playhead
    : (range.start + range.end) / 2;
}

export function trimSelectedAtPlayhead(
  clips: Clip[],
  index: number,
  playhead: number,
  side: "l" | "r",
) {
  const range = selectedClipRange(clips, index);
  if (!range || playhead - range.start < 0.1 || range.end - playhead < 0.1)
    return null;
  const sourceTime =
    range.clip.in + (playhead - range.start) * range.clip.speed;
  const clip =
    side === "l"
      ? { ...range.clip, in: sourceTime }
      : { ...range.clip, out: sourceTime };
  return {
    clips: clips.map((item, i) => (i === index ? clip : item)),
    time: side === "l" ? range.start : playhead,
  };
}
