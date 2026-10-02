/** Validate returned tracking evidence independently of the model or hosting provider. */
export function validateTrackingObservation(observation) {
  if (observation.kind !== "object_tracking") return;
  const { samples, start, end, frameCount } = observation;
  if (end <= start || end - start > 10 + 0.000001 || samples.length < 2 || samples.length !== frameCount
    || Math.abs(samples[0].time - start) > 0.000001 || Math.abs(samples.at(-1).time - end) > 0.000001)
    throw new Error("Object tracking must cover one complete nonempty interval of at most ten seconds.");
  let previous = -1;
  for (const sample of samples) {
    if (sample.time <= previous || sample.time < start || sample.time > end
      || sample.visible && (sample.width <= 0 || sample.height <= 0))
      throw new Error("Object tracking samples must have ordered timestamps and valid visible boxes.");
    previous = sample.time;
  }
}
