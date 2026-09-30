import { dur, total } from "../../../domain/clips/timing";
import type {
  Clip,
  PvoComponent,
  TextOverlay,
} from "../../../domain/project/model";
import { clamp } from "../../../domain/project/numbers";
import { TIMING_SNAP_DISTANCE_PX } from "../../timeline/timingSnap";

export const MIN_ZOOM = 16;
export const MAX_ZOOM = 120;
export const DEFAULT_ZOOM = 40;

export function timelineSnapPoints(
  clips: Clip[],
  components: PvoComponent[],
  texts: TextOverlay[],
) {
  let edge = 0;
  return [
    0,
    ...clips.map((clip) => (edge += dur(clip))),
    ...components.map((item) => item.at),
    ...texts.map((item) => item.start),
  ];
}

export function snappedTime(
  time: number,
  points: number[],
  pixelsPerSecond: number,
  length: number,
  enabled: boolean,
) {
  const bounded = clamp(time, 0, length);
  if (!enabled) return bounded;
  const nearest = points.reduce(
    (best, point) =>
      Math.abs(point - bounded) < Math.abs(best - bounded) ? point : best,
    Infinity,
  );
  return Math.abs(nearest - bounded) <=
    TIMING_SNAP_DISTANCE_PX / pixelsPerSecond
    ? clamp(nearest, 0, length)
    : bounded;
}

export function timelineWidth(clips: Clip[], pixelsPerSecond: number) {
  return (total(clips) + 8) * pixelsPerSecond;
}
