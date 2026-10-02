import { TRACKING_MAX_SECONDS } from "../../../../packages/pvo-assistant/native/index.js";
import { dur } from "../clips/timing";
import type { Scene } from "../project/model";
import type { AnimationTarget } from "./model";
import { getAnimationTarget } from "./targets";

export type TrackingRange = { clipId: number; start: number; end: number };

/** A tracked object needs one source clip and a layer that spans the entire result. */
export function trackingRangeBounds(scene: Scene, target: AnimationTarget, clipId: number) {
  if (target.kind === "audio" || target.kind === "music") return null;
  const info = getAnimationTarget(scene, target);
  if (!info || (target.kind === "clip" && target.id !== clipId)) return null;
  let cursor = 0;
  for (const clip of scene.clips) {
    const start = cursor;
    cursor += dur(clip);
    if (clip.id !== clipId || !clip.url) continue;
    const minimum = Math.max(info.start, start), maximum = Math.min(info.end, cursor);
    return maximum - minimum >= .001 ? { minimum, maximum } : null;
  }
  return null;
}

export function defaultTrackingRange(scene: Scene, target: AnimationTarget, playhead: number): TrackingRange | null {
  const choices = scene.clips.flatMap(clip => {
    const bounds = trackingRangeBounds(scene, target, clip.id);
    return bounds ? [{ clipId: clip.id, ...bounds }] : [];
  });
  const choice = choices.find(item => playhead >= item.minimum && playhead < item.maximum) ?? choices[0];
  if (!choice) return null;
  const start = Math.min(choice.maximum - .001, Math.max(choice.minimum, playhead));
  return { clipId: choice.clipId, start, end: Math.min(choice.maximum, start + TRACKING_MAX_SECONDS) };
}

export function validateTrackingRange(scene: Scene, target: AnimationTarget, range: TrackingRange): void {
  const bounds = trackingRangeBounds(scene, target, range.clipId);
  if (!bounds || !Number.isFinite(range.start) || !Number.isFinite(range.end)
    || range.start < bounds.minimum || range.end > bounds.maximum || range.end <= range.start
    || range.end - range.start > TRACKING_MAX_SECONDS)
    throw new Error("Choose up to ten seconds inside one video clip and the selected layer.");
}
