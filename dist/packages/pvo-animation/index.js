/** Numeric layer animation shared by the editor, exporter and standalone player. */
export { animatedCenterVisible, videoCoversPoint, visualMotionVisible } from "./visibility.js";
export const ANIMATION_DEFAULTS = Object.freeze({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, gain: 1 });
export const ANIMATION_LIMITS = Object.freeze({
  x: Object.freeze([-1000, 1000]), y: Object.freeze([-1000, 1000]),
  scaleX: Object.freeze([0, 10]), scaleY: Object.freeze([0, 10]),
  rotation: Object.freeze([-36000, 36000]), opacity: Object.freeze([0, 1]), gain: Object.freeze([0, 1]),
});
export const ANIMATION_PROPERTIES = Object.freeze(Object.keys(ANIMATION_DEFAULTS));
export const VISUAL_ANIMATION_PROPERTIES = Object.freeze(ANIMATION_PROPERTIES.filter(property => property !== "gain"));
export const ANIMATION_EASINGS = Object.freeze(["linear", "hold", "ease-in", "ease-out", "ease-in-out"]);
export const MAX_KEYFRAMES_PER_TRACK = 4096;
export const MAX_KEYFRAMES_PER_LAYER = 16384;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reject malformed curves at authoring/import boundaries; never silently repair them. */
export function parseAnimation(value, allowedProperties = ANIMATION_PROPERTIES) {
  if (!record(value) || Object.keys(value).some(key => key !== "tracks") || !record(value.tracks))
    throw new Error("Animation must contain numeric tracks.");
  const tracks = {};
  let total = 0;
  for (const [property, frames] of Object.entries(value.tracks)) {
    if (!ANIMATION_PROPERTIES.includes(property) || !allowedProperties.includes(property))
      throw new Error(`Animation property ${property} is not supported by this layer.`);
    if (!Array.isArray(frames) || !frames.length || frames.length > MAX_KEYFRAMES_PER_TRACK)
      throw new Error("An animation track must contain 1–4096 keyframes.");
    total += frames.length;
    if (total > MAX_KEYFRAMES_PER_LAYER) throw new Error("A layer supports at most 16384 keyframes.");
    let previous = -1;
    const [minimum, maximum] = ANIMATION_LIMITS[property];
    tracks[property] = frames.map(frame => {
      if (!record(frame) || Object.keys(frame).some(key => !["time", "value", "easing"].includes(key))
        || !Number.isFinite(frame.time) || frame.time < 0 || frame.time > 86400 || frame.time <= previous
        || !Number.isFinite(frame.value) || frame.value < minimum || frame.value > maximum
        || !ANIMATION_EASINGS.includes(frame.easing))
        throw new Error(`Invalid ${property} keyframe: times must be finite, ordered and unique, with a supported value and easing.`);
      previous = frame.time;
      return { time: frame.time, value: frame.value, easing: frame.easing };
    });
  }
  return { tracks };
}

export function cloneAnimation(animation) {
  if (!animation) return undefined;
  return { tracks: Object.fromEntries(Object.entries(animation.tracks)
    .map(([property, frames]) => [property, frames.map(frame => ({ ...frame }))])) };
}

function eased(progress, easing) {
  if (easing === "hold") return 0;
  if (easing === "ease-in") return progress * progress;
  if (easing === "ease-out") return 1 - (1 - progress) ** 2;
  if (easing === "ease-in-out") return progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
  return progress;
}

/** Curves hold their endpoint values outside their range. Easing belongs to the outgoing key. */
export function evaluateAnimation(animation, time) {
  const values = { ...ANIMATION_DEFAULTS };
  if (!animation || !Number.isFinite(time)) return values;
  for (const property of ANIMATION_PROPERTIES) {
    const frames = animation.tracks[property];
    if (!frames?.length) continue;
    if (time <= frames[0].time) { values[property] = frames[0].value; continue; }
    const last = frames[frames.length - 1];
    if (time >= last.time) { values[property] = last.value; continue; }
    let low = 0;
    let high = frames.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >>> 1;
      if (frames[middle].time <= time) low = middle;
      else high = middle;
    }
    const left = frames[low];
    const right = frames[high];
    values[property] = left.value + (right.value - left.value)
      * eased((time - left.time) / (right.time - left.time), left.easing);
  }
  return values;
}
