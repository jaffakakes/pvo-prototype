export const TIMING_SNAP_DISTANCE_PX = 8;
const TIMING_SNAP_EPSILON_PX = Number.EPSILON * 64;

export type TimingSnapSettings = {
  enabled: boolean;
  playhead: number;
};

export type TimingSnapResult = {
  delta: number;
  snapped: boolean;
};

/** Magnetizes one moving timing edge to the stationary playhead in screen pixels. */
export function snappedTimingDelta(
  edgeTime: number,
  delta: number,
  playhead: number,
  pixelsPerSecond: number,
  enabled: boolean,
): TimingSnapResult {
  if (!enabled || !Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0)
    return { delta, snapped: false };
  const snapDelta = playhead - edgeTime;
  const distance = Math.abs(delta - snapDelta) * pixelsPerSecond;
  return distance <= TIMING_SNAP_DISTANCE_PX + TIMING_SNAP_EPSILON_PX
    ? { delta: snapDelta, snapped: true }
    : { delta, snapped: false };
}
