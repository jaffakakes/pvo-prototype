import { locate, total } from "../clips/timing";
import type { Clip, PvoComponent } from "../project/model";
import { clamp } from "../project/numbers";

/** A component starts at least this long before the scene ends so it can appear. */
export const COMPONENT_START_MARGIN = .1;
/** A timed component stays on screen for at least this long. */
export const MIN_COMPONENT_DURATION = .5;

export type TimingDragMode = "move" | "start" | "end";
export type ComponentTiming = Pick<PvoComponent, "at" | "dur">;
/** The start time and visible length a timing gesture began from. */
export type ComponentTimingSpan = { at: number; length: number };

export function componentEnd(component: PvoComponent, clips: Clip[]) {
  const length = total(clips);
  if (component.dur != null)
    return Math.min(length, component.at + component.dur);
  const here = locate(component.at, clips);
  return here ? Math.min(length, here.start + here.d) : length;
}

export function componentLength(component: PvoComponent, clips: Clip[]) {
  return Math.max(0, componentEnd(component, clips) - component.at);
}

export function clampComponentStart(at: number, sceneLength: number) {
  return clamp(at, 0, Math.max(0, sceneLength - COMPONENT_START_MARGIN));
}

/**
 * Timing after dragging by `delta` seconds from the gesture's starting span.
 * Moving keeps the stored duration, including "until the clip ends"; trimming
 * either edge fixes an explicit duration of at least the minimum.
 */
export function dragComponentTiming(start: ComponentTimingSpan, mode: TimingDragMode, delta: number, sceneLength: number): Partial<ComponentTiming> {
  const end = start.at + start.length;
  if (mode === "move")
    return { at: clampComponentStart(start.at + delta, sceneLength) };
  if (mode === "start") {
    const at = clamp(start.at + delta, 0, Math.max(0, end - MIN_COMPONENT_DURATION));
    return { at, dur: end - at };
  }
  const minimumEnd = start.at + MIN_COMPONENT_DURATION;
  return { dur: clamp(end + delta, minimumEnd, Math.max(minimumEnd, sceneLength)) - start.at };
}
