import { parseAnimation, VISUAL_ANIMATION_PROPERTIES } from "../../pvo-animation/index.js";

/** Validate numeric animation before any host evaluates it or applies CSS. */
export function validateManifestAnimation(manifest, errors) {
  const animation = (value, path, properties) => {
    if (value === undefined) return;
    try { parseAnimation(value, properties); }
    catch (error) { errors.push(`${path}: ${error.message}`); }
  };
  for (const [index, component] of (manifest.components || []).entries())
    animation(component?.restyle_capture?.animation, `components[${index}].restyle_capture.animation`, VISUAL_ANIMATION_PROPERTIES);
  const scenes = manifest.restyle_capture?.scene_layers;
  if (scenes === undefined) return;
  if (!scenes || typeof scenes !== "object" || Array.isArray(scenes)) {
    errors.push("restyle_capture.scene_layers must be an object.");
    return;
  }
  for (const [id, layers] of Object.entries(scenes)) {
    const path = `restyle_capture.scene_layers.${id}`;
    if (!layers || typeof layers !== "object" || Array.isArray(layers)) {
      errors.push(`${path} must be an object.`); continue;
    }
    if (!(manifest.scenes || []).some(scene => scene.id === id)) errors.push(`${path} references a missing scene.`);
    for (const key of ["texts", "clips", "audioClips"]) {
      if (layers[key] === undefined) continue;
      if (!Array.isArray(layers[key])) { errors.push(`${path}.${key} must be an array.`); continue; }
      for (const [index, layer] of layers[key].entries()) {
        animation(layer?.animation, `${path}.${key}[${index}].animation`,
          key === "texts" ? VISUAL_ANIMATION_PROPERTIES : key === "audioClips" ? ["gain"] : undefined);
        if (key !== "texts" && layer?.animation !== undefined
          && (![layer.start, layer.in, layer.out, layer.speed].every(Number.isFinite)
            || layer.start < 0 || layer.in < 0 || layer.out <= layer.in || layer.speed <= 0))
          errors.push(`${path}.${key}[${index}] has an invalid animation source clock.`);
      }
    }
    animation(layers.musicAnimation, `${path}.musicAnimation`, ["gain"]);
  }
}
