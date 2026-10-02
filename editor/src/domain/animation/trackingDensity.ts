import type { NativeObjectTrackingObservation, NativeTrackingSample } from "../../../../packages/pvo-assistant/native/index.js";
import type { TrackingStep } from "./trackingMetadata";

const reliable = (sample: NativeTrackingSample) => sample.visible && sample.score >= 0.25;

/** Regular editable keys retain measured entry/exit boundaries rather than bridging a lost subject. */
export function fitTrackingDensity(observation: NativeObjectTrackingObservation, step: TrackingStep): NativeObjectTrackingObservation {
  if (![0.5, 1, 2].includes(step)) throw new Error("Choose a tracking density of half, one or two seconds.");
  const times = new Set([observation.start, observation.end]);
  for (let time = observation.start + step; time < observation.end; time += step) times.add(time);
  const samples = observation.samples;
  for (let index = 0; index < samples.length; index++) {
    if (index && reliable(samples[index]) !== reliable(samples[index - 1])) {
      times.add(samples[index - 1].time);
      times.add(samples[index].time);
    }
  }
  const fitted = [...times].sort((a, b) => a - b).map(time => {
    const exact = samples.find(sample => Math.abs(sample.time - time) < 0.000001);
    if (exact) return { ...exact, time };
    const rightIndex = samples.findIndex(sample => sample.time > time);
    const left = samples[rightIndex - 1];
    const right = samples[rightIndex];
    if (!left || !right || !reliable(left) || !reliable(right))
      return { time, visible: false, x: 0, y: 0, width: 0, height: 0, score: 0 };
    const amount = (time - left.time) / (right.time - left.time);
    const mix = (property: "x" | "y" | "width" | "height") => left[property] + (right[property] - left[property]) * amount;
    return { time, visible: true, x: mix("x"), y: mix("y"), width: mix("width"), height: mix("height"), score: Math.min(left.score, right.score) };
  });
  return { ...observation, samples: fitted, frameCount: fitted.length };
}
