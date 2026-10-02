import {
  ANIMATION_PROPERTIES, VISUAL_ANIMATION_PROPERTIES, parseAnimation,
  type AnimationProperty,
} from "../../../../packages/pvo-animation/index.js";
import type { Scene } from "../project/model";
import { parseLayerTracking } from "./trackingMetadata";

/** Validate persisted curves before they reach rendering or history restoration. */
export function assertSceneAnimation(scene: Scene): void {
  const validate = (value: unknown, properties: readonly AnimationProperty[], layer: string) => {
    if (value === undefined) return;
    try {
      parseAnimation(value, properties);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Scene ${scene.id}, ${layer}: ${detail}`);
    }
  };
  for (const clip of scene.clips) validate(clip.animation, ANIMATION_PROPERTIES, `video ${clip.id}`);
  for (const text of scene.texts) validate(text.animation, VISUAL_ANIMATION_PROPERTIES, `text ${text.id}`);
  for (const component of scene.components)
    validate(component.animation, VISUAL_ANIMATION_PROPERTIES, `component ${component.id}`);
  for (const audio of scene.audioClips ?? []) validate(audio.animation, ["gain"], `audio ${audio.id}`);
  validate(scene.musicAnimation, ["gain"], "music");
  for (const layer of [...scene.clips, ...scene.texts, ...scene.components]) {
    if (layer.animationTracking !== undefined) parseLayerTracking(layer.animationTracking);
  }
}
