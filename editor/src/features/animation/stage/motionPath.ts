export type StagePoint = { x: number; y: number };
type PathPoint = StagePoint & { time: number };

/** Pixel geometry only: values and easing come from the canonical animation reader. */
export function motionPath({ start, end, keyTimes, width, height, valueAt, pathDots = true }: {
  start: number;
  end: number;
  keyTimes: readonly number[];
  width: number;
  height: number;
  valueAt(time: number): StagePoint;
  pathDots?: boolean;
}) {
  const points: PathPoint[] = [];
  const dots: PathPoint[] = [];
  const toPoint = (time: number): PathPoint => {
    const value = valueAt(time);
    return { time, x: value.x * width / 100, y: value.y * height / 100 };
  };
  const keys = keyTimes.filter(time => time >= start && time <= end).map(toPoint);
  if (end < start || width <= 0 || height <= 0) return { points, dots, keys };

  // Constant spans need only their endpoints. This also avoids sampling hours of
  // unchanged position before/after a short animation on a long source clip.
  const boundaries = [...new Set([start, ...keys.map(key => key.time), end])].sort((a, b) => a - b);
  const addPoint = (point: PathPoint) => {
    const previous = points.at(-1);
    if (!previous || Math.round(previous.x * 10) !== Math.round(point.x * 10)
      || Math.round(previous.y * 10) !== Math.round(point.y * 10)) points.push(point);
  };
  const addDot = (point: PathPoint) => {
    const previous = dots.at(-1);
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) >= 2.5) dots.push(point);
  };
  for (let index = 0; index < boundaries.length - 1; index++) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    const first = toPoint(from);
    const last = toPoint(to);
    addPoint(first);
    const stationary = first.x === last.x && first.y === last.y;
    if (!stationary) {
      const firstTick = Math.ceil((from - start) * 10 - 1e-8);
      const lastTick = Math.floor((to - start) * 10 + 1e-8);
      for (let tick = firstTick; tick <= lastTick; tick++) addPoint(toPoint(start + tick / 10));
    }
    if (pathDots) {
      const firstTick = Math.ceil((from - start) * 5 - 1e-8);
      const lastTick = Math.floor((to - start) * 5 + 1e-8);
      for (let tick = firstTick; tick <= lastTick; tick++) {
        addDot(toPoint(start + tick / 5));
        if (stationary) break;
      }
    }
    addPoint(last);
  }
  return { points, dots, keys };
}
