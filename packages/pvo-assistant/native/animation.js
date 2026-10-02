import { ANIMATION_PROPERTIES, VISUAL_ANIMATION_PROPERTIES, parseAnimation } from "../../pvo-animation/index.js";

export function nativeAnimationProperties(kind) {
  return kind === "clip" ? ANIMATION_PROPERTIES : kind === "audio" || kind === "music" || kind === "scene"
    ? ["gain"] : VISUAL_ANIMATION_PROPERTIES;
}

export function validateAnimationOperation(operation) {
  if (!operation.kind.startsWith("animation.")) return;
  const properties = nativeAnimationProperties(operation.target.kind);
  if (operation.property && !properties.includes(operation.property))
    throw new Error("The animation property is unsupported by this layer.");
  if (operation.kind === "animation.set") {
    if (!Object.keys(operation.tracks).length) throw new Error("Set at least one animation track.");
    parseAnimation({ tracks: operation.tracks }, properties);
  }
}

export function validateEntityAnimation(kind, values) {
  const animation = kind === "scene" ? values.musicAnimation : values.animation;
  if (animation !== undefined) parseAnimation(animation, nativeAnimationProperties(kind));
}

export function validateProjectAnimations(project) {
  for (const scene of project.scenes) {
    validateEntityAnimation("scene", scene);
    for (const [kind, collection] of [["clip", "clips"], ["audio", "audioClips"], ["text", "texts"], ["component", "components"]])
      for (const values of scene[collection]) validateEntityAnimation(kind, values);
  }
}
