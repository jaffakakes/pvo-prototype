import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import type { NativeObjectTrackingObservation, NativeVisualAnimationTarget } from "../../../../packages/pvo-assistant/native/index.js";
import type { Scene } from "../project/model";
import { replaceLayerAnimation } from "./editing";
import type { AnimationKeyframe, AnimationProperty, AnimationTargetInfo, LayerAnimation } from "./model";
import { simplifyLinearKeys } from "./simplify";
import { animationSceneTime, animationTime, getAnimationTarget } from "./targets";

export type TrackingAttachment = { anchor: "center" | "top"; offsetX: number; offsetY: number };
const EPSILON = 0.000001;
const MAX_TRACKING_KEYS = 120;

function mergedCurve(info: AnimationTargetInfo, property: AnimationProperty, generated: AnimationKeyframe[], start: number, end: number) {
  const original = (info.animation?.tracks[property] ?? []).map(frame => ({ ...frame, time: animationSceneTime(info, frame.time) }));
  const valueAt = (time: number) => evaluateAnimation(info.animation, animationTime(info, time))[property];
  const easingAt = (time: number) => [...original].reverse().find(frame => frame.time <= time)?.easing ?? "linear";
  for (const boundary of [start, end]) {
    const left = [...original].reverse().find(frame => frame.time < boundary);
    const right = original.find(frame => frame.time > boundary);
    if (left && right && left.easing !== "linear" && left.easing !== "hold")
      throw new Error("Tracking would cut through an existing eased animation. Track the whole layer or clear that position/opacity curve first.");
  }
  const before = original.filter(frame => frame.time < start - EPSILON * 1.5);
  const after = original.filter(frame => frame.time > end + EPSILON * 1.5);
  if (start > info.start + EPSILON) before.push({ time: start - EPSILON, value: valueAt(start - EPSILON), easing: "hold" });
  if (end < info.end - EPSILON) after.unshift({ time: end + EPSILON, value: valueAt(end + EPSILON), easing: easingAt(end + EPSILON) });
  const frames = [...before, ...generated, ...after];
  if (frames.length > MAX_TRACKING_KEYS) throw new Error("This track is too complex to keep within the verified animation budget. Track a shorter section.");
  return frames;
}

/** Convert measured canvas centers to editable keyframes; no model-authored coordinates are accepted. */
export function followObjectTracking(scene: Scene, target: NativeVisualAnimationTarget,
  observation: NativeObjectTrackingObservation, attachment: TrackingAttachment,
  options: { simplify?: boolean; cameraBaseline?: LayerAnimation; allowGeneratedOpacity?: boolean } = {}): Scene {
  if (observation.kind !== "object_tracking" || observation.model !== "sam3.1" || observation.sceneId !== scene.id)
    throw new Error("Use a completed SAM 3.1 observation from this scene.");
  const info = getAnimationTarget(scene, target);
  const source = getAnimationTarget(scene, { kind: "clip", id: observation.clipId });
  if (!info || !source || observation.start < source.start - EPSILON || observation.end > source.end + EPSILON
    || observation.end <= observation.start || observation.end - observation.start > 10 + EPSILON
    || observation.start < info.start - EPSILON || observation.end > info.end + EPSILON)
    throw new Error("The tracked source and target must span the complete tracking interval.");
  if (target.kind === "clip" && target.id !== observation.clipId)
    throw new Error("Camera tracking must use the clip that was inspected.");
  if (![attachment.offsetX, attachment.offsetY].every(value => Number.isFinite(value) && Math.abs(value) <= 100)
    || !["center", "top"].includes(attachment.anchor)) throw new Error("Choose a supported tracking anchor and offset.");
  const samples = observation.samples;
  if (samples.length < 2 || samples.length !== observation.frameCount || samples.length > 151
    || Math.abs(samples[0].time - observation.start) > EPSILON || Math.abs(samples.at(-1)!.time - observation.end) > EPSILON)
    throw new Error("Tracking evidence must contain the actual complete sampled interval.");
  let previous = -1;
  for (const sample of samples) {
    if (!Number.isFinite(sample.time) || sample.time <= previous || sample.time < observation.start || sample.time > observation.end
      || typeof sample.visible !== "boolean"
      || ![sample.x, sample.y, sample.width, sample.height, sample.score].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
      throw new Error("Tracking evidence contains invalid sample geometry or timing.");
    previous = sample.time;
  }
  const confidentSamples = samples.filter(sample => sample.visible && sample.score >= 0.25).length;
  if (!confidentSamples) throw new Error("The requested object was not tracked confidently.");
  if (confidentSamples < 2)
    throw new Error("The object was found but could not be followed. Pick a clearer object or a shorter range.");
  const hasGaps = samples.some(sample => !sample.visible || sample.score < 0.25);
  if (target.kind !== "clip" && hasGaps && info.animation?.tracks.opacity && !options.allowGeneratedOpacity)
    throw new Error("Tracking gaps need visibility keys, but this layer already has an opacity animation. Clear that curve or track a continuously visible section first.");
  const layer = target.kind === "text" ? scene.texts.find(item => item.id === target.id)
    : target.kind === "component" ? scene.components.find(item => item.id === target.id) : null;
  const base = { x: layer?.x ?? 50, y: layer?.y ?? 50 };
  const keys = { x: [] as AnimationKeyframe[], y: [] as AnimationKeyframe[], opacity: [] as AnimationKeyframe[] };
  let lastPosition = evaluateAnimation(info.animation, animationTime(info, observation.start));
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const visible = sample.visible && sample.score >= 0.25;
    const old = evaluateAnimation(target.kind === "clip" ? options.cameraBaseline ?? info.animation : info.animation, animationTime(info, sample.time));
    if (visible) {
      const anchorX = sample.x * 100;
      const anchorY = (sample.y - (attachment.anchor === "top" ? sample.height / 2 : 0)) * 100;
      lastPosition = { ...old,
        x: target.kind === "clip" ? old.x + 50 + attachment.offsetX - anchorX : anchorX + attachment.offsetX - base.x,
        y: target.kind === "clip" ? old.y + 50 + attachment.offsetY - anchorY : anchorY + attachment.offsetY - base.y };
    }
    const nextVisible = samples[index + 1]?.visible && samples[index + 1].score >= 0.25;
    const easing = visible && nextVisible ? "linear" : "hold";
    keys.x.push({ time: sample.time, value: lastPosition.x, easing });
    keys.y.push({ time: sample.time, value: lastPosition.y, easing });
    keys.opacity.push({ time: sample.time, value: visible ? 1 : 0, easing });
  }
  const fit = (frames: AnimationKeyframe[], tolerance: number) => options.simplify === false ? frames : simplifyLinearKeys(frames, tolerance);
  const tracks = {
    x: mergedCurve(info, "x", fit(keys.x, 0.15), observation.start, observation.end),
    y: mergedCurve(info, "y", fit(keys.y, 0.15), observation.start, observation.end),
    ...(target.kind === "clip" || !hasGaps ? {} : {
      opacity: mergedCurve(info, "opacity", simplifyLinearKeys(keys.opacity, 0.002), observation.start, observation.end),
    }),
  };
  const canonical = { ...info.animation?.tracks };
  for (const property of ["x", "y", "opacity"] as const) if (tracks[property])
    canonical[property] = tracks[property]!.map(frame => ({ ...frame, time: animationTime(info, frame.time) }));
  return replaceLayerAnimation(scene, target, { tracks: canonical });
}
