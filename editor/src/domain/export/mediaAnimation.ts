import { cloneAnimation } from "../../../../packages/pvo-animation/index.js";
import { dur } from "../clips/timing";
import type { Scene } from "../project/model";

/** Retain authored media curves and their clocks; only media gain is already rendered; visual motion stays live. */
export function manifestMediaAnimations(scene: Scene) {
  let cursor = 0;
  const clips = scene.clips.flatMap(clip => {
    const start = cursor;
    cursor += dur(clip);
    return clip.animation ? [{ id: clip.id, start, in: clip.in, out: clip.out, speed: clip.speed,
      animation: cloneAnimation(clip.animation) }] : [];
  });
  const audioClips = (scene.audioClips ?? []).flatMap(clip => clip.animation
    ? [{ id: clip.id, start: clip.start, in: clip.in, out: clip.out, speed: clip.speed,
      animation: cloneAnimation(clip.animation) }] : []);
  return {
    ...(clips.length ? { clips } : {}),
    ...(audioClips.length ? { audioClips } : {}),
    ...(scene.musicAnimation ? { musicAnimation: cloneAnimation(scene.musicAnimation) } : {}),
  };
}
