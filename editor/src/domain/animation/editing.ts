import { cloneAnimation, parseAnimation } from "../../../../packages/pvo-animation/index.js";
import type { Scene } from "../project/model";
import type { AnimationEasing, AnimationKeyframe, AnimationProperty, AnimationTarget, AnimationTargetInfo, LayerAnimation } from "./model";
import { animationTime, getAnimationTarget } from "./targets";
import type { LayerTracking } from "./trackingMetadata";

export const KEYFRAME_TIME_EPSILON = 0.000001;
export type AnimationChange =
  | { kind: "set"; property: AnimationProperty; time: number; value: number; easing: AnimationEasing }
  | { kind: "remove"; property: AnimationProperty; time: number }
  | { kind: "move"; property: AnimationProperty; from: number; to: number }
  | { kind: "clear"; property?: AnimationProperty }
  /** Replace the addressed curves; input times use scene seconds like manual commands. */
  | { kind: "tracks"; tracks: LayerAnimation["tracks"] };

function localTime(info: AnimationTargetInfo, sceneTime: number): number {
  if (!Number.isFinite(sceneTime) || sceneTime < info.start - KEYFRAME_TIME_EPSILON || sceneTime > info.end + KEYFRAME_TIME_EPSILON)
    throw new Error("Keyframe time must be inside the selected layer.");
  return Math.max(0, animationTime(info, Math.max(info.start, Math.min(info.end, sceneTime))));
}

function replaceAnimation(scene: Scene, target: AnimationTarget, animation: LayerAnimation | undefined): Scene {
  const assign = <T extends { animation?: LayerAnimation; animationTracking?: LayerTracking }>(item: T): T => {
    const { animation: _previous, animationTracking, ...base } = item;
    const generatedTimes = animationTracking?.generatedTimes.filter(time => [animation?.tracks.x, animation?.tracks.y]
      .some(frames => frames?.some(frame => Math.abs(frame.time - time) < KEYFRAME_TIME_EPSILON)));
    return { ...base, ...(animation ? { animation } : {}),
      ...(generatedTimes?.length ? { animationTracking: { ...animationTracking!, generatedTimes } } : {}) } as T;
  };
  if (target.kind === "music") {
    const { musicAnimation: _previous, ...base } = scene;
    return { ...base, ...(animation ? { musicAnimation: animation } : {}) };
  }
  if (target.kind === "clip") return { ...scene, clips: scene.clips.map(item => item.id === target.id ? assign(item) : item) };
  if (target.kind === "audio") return { ...scene, audioClips: scene.audioClips?.map(item => item.id === target.id ? assign(item) : item) };
  if (target.kind === "text") return { ...scene, texts: scene.texts.map(item => item.id === target.id ? assign(item) : item) };
  return { ...scene, components: scene.components.map(item => item.id === target.id ? assign(item) : item) };
}

/** Trusted generators may retain valid source keys outside a currently trimmed visible range. */
export function replaceLayerAnimation(scene: Scene, target: AnimationTarget, animation: LayerAnimation): Scene {
  const info = getAnimationTarget(scene, target);
  if (!info) throw new Error("The animation layer no longer exists.");
  const validated = parseAnimation(animation, info.properties);
  if (JSON.stringify(validated) === JSON.stringify(info.animation)) return scene;
  return replaceAnimation(scene, target, validated);
}

/** One pure rule for UI, assistant batches and generated tracking curves. Never mutates input. */
export function changeLayerAnimation(scene: Scene, target: AnimationTarget, change: AnimationChange): Scene {
  const info = getAnimationTarget(scene, target);
  if (!info) throw new Error("The animation layer no longer exists.");
  if ("property" in change && change.property && !info.properties.includes(change.property))
    throw new Error(`Animation property ${change.property} is not supported by this layer.`);
  const tracks = cloneAnimation(info.animation)?.tracks ?? {};
  if (change.kind === "clear") {
    if (change.property) delete tracks[change.property];
    else for (const property of info.properties) delete tracks[property];
  } else if (change.kind === "tracks") {
    const validated = parseAnimation({ tracks: change.tracks }, info.properties);
    for (const property of info.properties) if (validated.tracks[property])
      tracks[property] = validated.tracks[property]!.map(frame => ({ ...frame, time: localTime(info, frame.time) }));
  } else {
    const frames = tracks[change.property] ?? [];
    const time = localTime(info, change.kind === "move" ? change.from : change.time);
    const index = frames.findIndex(frame => Math.abs(frame.time - time) < KEYFRAME_TIME_EPSILON);
    if (change.kind === "set") {
      const frame: AnimationKeyframe = { time: index < 0 ? time : frames[index].time, value: change.value, easing: change.easing };
      if (index < 0) frames.push(frame);
      else frames[index] = frame;
    } else if (change.kind === "remove") {
      if (index < 0) return scene;
      frames.splice(index, 1);
    } else {
      if (index < 0) throw new Error("The keyframe no longer exists.");
      const destination = localTime(info, change.to);
      if (frames.some((frame, at) => at !== index && Math.abs(frame.time - destination) < KEYFRAME_TIME_EPSILON))
        throw new Error("A keyframe already exists at that time.");
      frames[index] = { ...frames[index], time: destination };
    }
    if (frames.length) tracks[change.property] = frames.sort((left, right) => left.time - right.time);
    else delete tracks[change.property];
  }
  const animation = Object.keys(tracks).length ? parseAnimation({ tracks }, info.properties) : undefined;
  if (JSON.stringify(animation) === JSON.stringify(info.animation)) return scene;
  return replaceAnimation(scene, target, animation);
}
