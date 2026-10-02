import { cloneAnimation, evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import type { Scene } from "../project/model";
import { replaceLayerAnimation } from "./editing";
import type { AnimationKeyframe, AnimationTarget } from "./model";
import { animationSceneTime, animationTime, getAnimationTarget } from "./targets";

export type SpeechRange = { start: number; end: number };
export const DUCKING_GAIN_ERROR = .002;
const ATTACK = .2;
const RELEASE = .35;

function mergedRanges(ranges: SpeechRange[]): SpeechRange[] {
  const result: SpeechRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

/** Compose a speech envelope with existing volume, retaining unaffected source keys. */
export function duckAuthoringVolume(scene: Scene, target: AnimationTarget, speech: readonly SpeechRange[]): Scene {
  if (target.kind !== "audio" && target.kind !== "music") throw new Error("Select music or an audio layer to duck under speech.");
  const info = getAnimationTarget(scene, target);
  if (!info) throw new Error("The selected audio layer no longer exists.");
  if (speech.some(range => !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start))
    throw new Error("Speech detection returned invalid time ranges.");
  const ranges = mergedRanges(speech.map(range => ({ start: Math.max(info.start, range.start), end: Math.min(info.end, range.end) }))
    .filter(range => range.end > range.start));
  if (!ranges.length) throw new Error("No speech was found in the other audible layers.");
  const original = (info.animation?.tracks.gain ?? []).map(frame => ({ ...frame, time: animationSceneTime(info, frame.time) }));
  const baseline = (time: number) => evaluateAnimation(info.animation, animationTime(info, time)).gain;
  const multiplier = (time: number) => {
    let value = 1;
    for (const range of ranges) {
      const start = Math.max(info.start, range.start - ATTACK);
      const end = Math.min(info.end, range.end + RELEASE);
      if (time < start || time > end) continue;
      const gain = time < range.start ? 1 - .6 * (time - start) / (range.start - start)
        : time <= range.end ? .4 : .4 + .6 * (time - range.end) / (end - range.end);
      value = Math.min(value, gain);
    }
    return value;
  };
  const valueAt = (time: number) => baseline(time) * multiplier(time);
  let spans = ranges.map(range => ({ start: Math.max(info.start, range.start - ATTACK), end: Math.min(info.end, range.end + RELEASE) }));
  // A split quadratic segment cannot keep the same named easing on both halves.
  // Include the intersected eased segment, then approximate only that affected
  // region. Original keys/easings outside these spans remain byte-for-byte intact.
  spans = mergedRanges(spans.map(span => {
    const expanded = { ...span };
    for (let index = 0; index < original.length - 1; index++) {
      const left = original[index], right = original[index + 1];
      if (left.easing === "linear" || left.easing === "hold" || right.time <= span.start || left.time >= span.end) continue;
      expanded.start = Math.min(expanded.start, left.time);
      expanded.end = Math.max(expanded.end, right.time);
    }
    return expanded;
  }));
  const generated: AnimationKeyframe[] = [];
  const appendSegment = (start: number, end: number, depth = 0) => {
    const a = valueAt(start), b = valueAt(end);
    const boundary = original.findIndex(frame => frame.time === end);
    if (boundary > 0 && original[boundary - 1].easing === "hold" && end - start <= .0000011 / info.clock.rate) {
      generated.push({ time: start, value: a, easing: "hold" });
      return;
    }
    const error = Math.max(...[.25, .5, .75].map(fraction =>
      Math.abs(valueAt(start + (end - start) * fraction) - (a + (b - a) * fraction))));
    if (error > DUCKING_GAIN_ERROR / 2) {
      if (depth >= 18 || end - start <= .0000001)
        throw new Error("This volume curve could not be ducked without changing its timing. Simplify the nearby volume keys first.");
      const middle = (start + end) / 2;
      appendSegment(start, middle, depth + 1);
      appendSegment(middle, end, depth + 1);
    } else generated.push({ time: start, value: a, easing: "linear" });
    if (generated.length > 4000) throw new Error("This volume curve is too complex to duck safely. Choose a shorter audio layer.");
  };
  for (const span of spans) {
    const knots = [span.start, span.end];
    for (const range of ranges) knots.push(range.start - ATTACK, range.start, range.end, range.end + RELEASE);
    original.forEach((frame, index) => {
      knots.push(frame.time);
      if (index && original[index - 1].easing === "hold" && original[index - 1].value !== frame.value)
        knots.push(frame.time - .000001 / info.clock.rate);
    });
    const times = [...new Set(knots.filter(time => time >= span.start && time <= span.end))].sort((a, b) => a - b);
    for (let index = 0; index < times.length - 1; index++) appendSegment(times[index], times[index + 1]);
    const exact = original.find(frame => frame.time === span.end);
    const preceding = original.filter(frame => frame.time < span.end).at(-1);
    generated.push({ time: span.end, value: valueAt(span.end), easing: exact?.easing ?? preceding?.easing ?? "linear" });
  }
  const retained = original.filter(frame => !spans.some(span => frame.time >= span.start && frame.time <= span.end));
  const gain = [...retained, ...generated].sort((a, b) => a.time - b.time)
    .map(frame => ({ ...frame, time: animationTime(info, frame.time) }));
  return replaceLayerAnimation(scene, target, { tracks: { ...cloneAnimation(info.animation)?.tracks, gain } });
}
