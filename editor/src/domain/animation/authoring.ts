import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import type { Scene } from "../project/model";
import { KEYFRAME_TIME_EPSILON } from "./editing";
import type { AnimationEasing, AnimationProperty, AnimationTarget } from "./model";
import { animationSceneTime, animationTime, getAnimationTarget } from "./targets";

export type AnimationGroup = "position" | "scale" | "rotation" | "opacity" | "volume";
export type AuthoringValue = number | { x: number; y: number };
export type AuthoringKey = { time: number; value: AuthoringValue; easing: AnimationEasing };
export type AuthoringOptions = { wholeTransform?: boolean; group?: AnimationGroup };

const visualGroups: AnimationGroup[] = ["position", "scale", "rotation", "opacity"];
export const AUTHORING_PROPERTIES: Record<AnimationGroup, readonly AnimationProperty[]> = {
  position: ["x", "y"], scale: ["scaleX", "scaleY"], rotation: ["rotation"], opacity: ["opacity"], volume: ["gain"],
};

export function getAuthoringGroups(target: AnimationTarget): AnimationGroup[] {
  if (target.kind === "audio" || target.kind === "music") return ["volume"];
  return target.kind === "clip" ? [...visualGroups, "volume"] : [...visualGroups];
}

export function authoringBasePosition(scene: Scene, target: AnimationTarget): { x: number; y: number } {
  const layer = target.kind === "text" ? scene.texts.find(item => item.id === target.id)
    : target.kind === "component" ? scene.components.find(item => item.id === target.id) : null;
  return { x: layer?.x ?? 50, y: layer?.y ?? 50 };
}

export function getAuthoringLayer(scene: Scene, target: AnimationTarget) {
  const info = getAnimationTarget(scene, target);
  if (!info) return null;
  let label: string;
  if (target.kind === "text") label = scene.texts.find(item => item.id === target.id)!.text || "Text";
  else if (target.kind === "component") {
    const component = scene.components.find(item => item.id === target.id)!;
    label = component.fields.title || component.fields.prompt || component.fields.heading || component.fields.text || component.type;
  } else if (target.kind === "audio") label = scene.audioClips!.find(item => item.id === target.id)!.name;
  else if (target.kind === "clip") label = `Video ${scene.clips.findIndex(item => item.id === target.id) + 1}`;
  else label = "Music";
  const audio = target.kind === "audio" || target.kind === "music";
  const color = audio ? "#5CF0C0" : target.kind === "clip" ? "#FF9FBC" : target.kind === "component" ? "#A78BFA" : "#FFD23E";
  return { start: info.start, end: info.end, label, color, audio };
}

export function readAuthoringValue(scene: Scene, target: AnimationTarget, group: AnimationGroup, time: number): AuthoringValue {
  const info = getAnimationTarget(scene, target);
  if (!info || !getAuthoringGroups(target).includes(group)) throw new Error("This layer does not support that animation property.");
  const values = evaluateAnimation(info.animation, animationTime(info, time));
  if (group === "position") {
    const base = authoringBasePosition(scene, target);
    return { x: base.x + values.x, y: base.y + values.y };
  }
  if (group === "scale") return values.scaleX;
  if (group === "volume") return values.gain * 100;
  return group === "opacity" ? values.opacity * 100 : values.rotation;
}

/** Paired controls expose the union of their keys without rewriting either underlying curve. */
export function getAuthoringKeys(scene: Scene, target: AnimationTarget, group: AnimationGroup): AuthoringKey[] {
  const info = getAnimationTarget(scene, target);
  if (!info || !getAuthoringGroups(target).includes(group)) return [];
  const frames = AUTHORING_PROPERTIES[group].flatMap(property => info.animation?.tracks[property] ?? []);
  const times = [...new Set(frames.map(frame => frame.time))].sort((left, right) => left - right);
  return times.map(time => ({ time: animationSceneTime(info, time),
    value: readAuthoringValue(scene, target, group, animationSceneTime(info, time)),
    easing: frames.find(frame => frame.time === time)!.easing }))
    .filter(frame => frame.time >= info.start - KEYFRAME_TIME_EPSILON && frame.time <= info.end + KEYFRAME_TIME_EPSILON);
}

export function animatedAuthoringGroups(scene: Scene, target: AnimationTarget): AnimationGroup[] {
  const info = getAnimationTarget(scene, target);
  return getAuthoringGroups(target).filter(group => AUTHORING_PROPERTIES[group].some(property => info?.animation?.tracks[property]?.length));
}

/** Quantize layer-local timeline seconds, never original source seconds. Endpoints remain reachable. */
export function snapAuthoringTime(time: number, start = 0, end = Infinity): number {
  if (!Number.isFinite(time) || !Number.isFinite(start) || end < start) throw new Error("Choose a valid keyframe time.");
  return Math.max(start, Math.min(end, start + Math.round((time - start) * 20) / 20));
}
