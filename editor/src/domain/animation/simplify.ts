import type { AnimationKeyframe } from "./model";

/** RDP on the time/value graph, measuring interpolation error in the property's own units. */
export function simplifyLinearKeys(frames: readonly AnimationKeyframe[], tolerance: number): AnimationKeyframe[] {
  frames = frames.filter((frame, index) => index === 0 || index === frames.length - 1
    || frame.easing !== "hold" || frames[index - 1].easing !== "hold" || frame.value !== frames[index - 1].value);
  if (frames.length < 3) return frames.map(frame => ({ ...frame }));
  const retained = new Set([0, frames.length - 1]);
  // Never interpolate across a gap or erase either side of a step transition.
  for (let i = 0; i < frames.length - 1; i++) if (frames[i].easing === "hold") {
    retained.add(i);
    retained.add(i + 1);
  }
  const fixed = [...retained].sort((a, b) => a - b);
  const pending: [number, number][] = fixed.slice(1).map((end, i) => [fixed[i], end]);
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let maximum = tolerance;
    let farthest = -1;
    for (let i = start + 1; i < end; i++) {
      const progress = (frames[i].time - frames[start].time) / (frames[end].time - frames[start].time);
      const expected = frames[start].value + (frames[end].value - frames[start].value) * progress;
      const error = Math.abs(frames[i].value - expected);
      if (error > maximum) { maximum = error; farthest = i; }
    }
    if (farthest >= 0) {
      retained.add(farthest);
      pending.push([start, farthest], [farthest, end]);
    }
  }
  return [...retained].sort((a, b) => a - b).map(index => ({ ...frames[index] }));
}
