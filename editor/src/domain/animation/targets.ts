import { ANIMATION_PROPERTIES, VISUAL_ANIMATION_PROPERTIES } from "../../../../packages/pvo-animation/index.js";
import { audioDuration } from "../audio/editing";
import { dur, total } from "../clips/timing";
import { componentEnd } from "../components/timing";
import { sceneDuration } from "../scenes/duration";
import type { Scene } from "../project/model";
import type { AnimationTarget, AnimationTargetInfo } from "./model";

export function getAnimationTarget(scene: Scene, target: AnimationTarget): AnimationTargetInfo | null {
  if (target.kind === "music") return { animation: scene.musicAnimation, properties: ["gain"],
    start: 0, end: sceneDuration(scene), clock: { origin: 0, offset: 0, rate: 1 } };
  if (target.kind === "clip") {
    const index = scene.clips.findIndex(clip => clip.id === target.id);
    if (index < 0) return null;
    const clip = scene.clips[index];
    const start = total(scene.clips.slice(0, index));
    return { animation: clip.animation, properties: ANIMATION_PROPERTIES, start, end: start + dur(clip),
      clock: { origin: start, offset: clip.in, rate: clip.speed } };
  }
  if (target.kind === "audio") {
    const audio = scene.audioClips?.find(clip => clip.id === target.id);
    return audio ? { animation: audio.animation, properties: ["gain"],
      start: audio.start, end: audio.start + audioDuration(audio),
      clock: { origin: audio.start, offset: audio.in, rate: audio.speed } } : null;
  }
  if (target.kind === "text") {
    const text = scene.texts.find(text => text.id === target.id);
    return text ? { animation: text.animation, properties: VISUAL_ANIMATION_PROPERTIES,
      start: text.start, end: text.end, clock: { origin: text.start, offset: 0, rate: 1 } } : null;
  }
  const component = scene.components.find(component => component.id === target.id);
  if (!component) return null;
  return { animation: component.animation, properties: VISUAL_ANIMATION_PROPERTIES,
    start: component.at, end: componentEnd(component, scene.clips),
    clock: { origin: component.at, offset: 0, rate: 1 } };
}

export function animationTime(info: AnimationTargetInfo, sceneTime: number): number {
  return info.clock.offset + (sceneTime - info.clock.origin) * info.clock.rate;
}

export function animationSceneTime(info: AnimationTargetInfo, localTime: number): number {
  return info.clock.origin + (localTime - info.clock.offset) / info.clock.rate;
}
