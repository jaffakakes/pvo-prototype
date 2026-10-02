import { validateManifestAnimation } from "./animation.js";
import { PVO_SPEC_VERSION } from "./constants.js";
import { validateActions } from "./actions.js";
import { validateSceneTree } from "./scene-tree.js";

const COMPONENT_KINDS = new Set(["tooltip", "card", "choice", "form"]);

/** Validate the small, deliberately data-only prototype manifest. */
export function validatePvo(manifest) {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["Manifest must be a JSON object."], warnings };
  }
  if (typeof manifest.spec_version !== "string") errors.push("spec_version is required.");
  else if (manifest.spec_version !== PVO_SPEC_VERSION) warnings.push(`This SDK targets ${PVO_SPEC_VERSION}; received ${manifest.spec_version}.`);
  if (!Array.isArray(manifest.scenes) || !manifest.scenes.length) errors.push("scenes must contain at least one scene.");
  if (!Array.isArray(manifest.components)) errors.push("components must be an array.");

  const ids = {
    scenes: new Set(), components: new Set(), hotspots: new Set(),
    media: new Set(), assets: new Set(), timelines: new Set(), clips: new Set(),
  };
  for (const [index, media] of (manifest.media || []).entries()) {
    const path = `media[${index}]`;
    if (!media?.id || typeof media.id !== "string") errors.push(`${path}.id is required.`);
    else if (ids.media.has(media.id)) errors.push(`${path}.id "${media.id}" is duplicated.`);
    else ids.media.add(media.id);
    const assetId = media?.asset_id || media?.id;
    if (typeof assetId !== "string" || !assetId) errors.push(`${path}.asset_id is required.`);
    else ids.assets.add(assetId);
  }
  for (const [index, scene] of (manifest.scenes || []).entries()) {
    const path = `scenes[${index}]`;
    if (!scene?.id || typeof scene.id !== "string") errors.push(`${path}.id is required.`);
    else if (ids.scenes.has(scene.id)) errors.push(`${path}.id "${scene.id}" is duplicated.`);
    else ids.scenes.add(scene.id);
    if (!Number.isFinite(scene?.start) || scene.start < 0) errors.push(`${path}.start must be 0 or greater.`);
    if (!Number.isFinite(scene?.end) || scene.end <= scene.start) errors.push(`${path}.end must be greater than start.`);
    if (scene?.asset_id && !ids.assets.has(scene.asset_id)) errors.push(`${path}.asset_id references missing media.`);
  }
  validateSceneTree(manifest.scenes || [], errors);
  const sceneGroups = new Map();
  [...(manifest.scenes || [])]
    .filter((scene) => Number.isFinite(scene?.start) && Number.isFinite(scene?.end))
    .forEach((scene) => {
      const group = scene.asset_id || "legacy";
      if (!sceneGroups.has(group)) sceneGroups.set(group, []);
      sceneGroups.get(group).push(scene);
    });
  for (const groupedScenes of sceneGroups.values()) {
    const orderedScenes = groupedScenes.sort((a, b) => a.start - b.start);
    for (let index = 1; index < orderedScenes.length; index += 1) {
      if (orderedScenes[index].start < orderedScenes[index - 1].end) {
        errors.push(`Scenes "${orderedScenes[index - 1].id}" and "${orderedScenes[index].id}" overlap.`);
      }
    }
  }

  if (manifest.playback != null) {
    if (!Array.isArray(manifest.playback?.timelines) || !manifest.playback.timelines.length) {
      errors.push("playback.timelines must contain at least the main timeline.");
    }
    for (const [timelineIndex, timeline] of (manifest.playback?.timelines || []).entries()) {
      const path = `playback.timelines[${timelineIndex}]`;
      if (timeline && Object.hasOwn(timeline, "source_component")) {
        errors.push(`${path}.source_component is not supported; route with component actions.`);
      }
      if (timeline && Object.hasOwn(timeline, "condition")) {
        errors.push(`${path}.condition is not supported; route with component actions.`);
      }
      if (!timeline?.id || typeof timeline.id !== "string") errors.push(`${path}.id is required.`);
      else if (ids.timelines.has(timeline.id)) errors.push(`${path}.id "${timeline.id}" is duplicated.`);
      else ids.timelines.add(timeline.id);
      if (!Array.isArray(timeline?.clips) || !timeline.clips.length) errors.push(`${path}.clips must contain at least one clip.`);
      for (const [clipIndex, clip] of (timeline?.clips || []).entries()) {
        const clipPath = `${path}.clips[${clipIndex}]`;
        if (!clip?.id || typeof clip.id !== "string") errors.push(`${clipPath}.id is required.`);
        else ids.clips.add(clip.id);
        if (!ids.assets.has(clip?.asset_id)) errors.push(`${clipPath}.asset_id references missing media.`);
        if (!Number.isFinite(clip?.start) || clip.start < 0) errors.push(`${clipPath}.start must be 0 or greater.`);
        if (!Number.isFinite(clip?.end) || clip.end <= clip.start) errors.push(`${clipPath}.end must be greater than start.`);
        if (clip?.scene && !ids.scenes.has(clip.scene)) errors.push(`${clipPath}.scene references a missing scene.`);
      }
    }
    if (!ids.timelines.has(manifest.playback?.initial_timeline)) {
      errors.push("playback.initial_timeline references a missing timeline.");
    }
  }
  for (const [index, component] of (manifest.components || []).entries()) {
    const path = `components[${index}]`;
    if (component && Object.hasOwn(component, "scene_change")) {
      errors.push(`${path}.scene_change is not supported; use an explicit goto_scene or seek action.`);
    }
    if (component && Object.hasOwn(component, "pause")) {
      errors.push(`${path}.pause is not supported; use response_policy.unanswered.`);
    }
    if (!component?.id || typeof component.id !== "string") errors.push(`${path}.id is required.`);
    else if (ids.components.has(component.id)) errors.push(`${path}.id "${component.id}" is duplicated.`);
    else ids.components.add(component.id);
    const presentation = component?.presentation;
    if (presentation !== undefined) {
      if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
        errors.push(`${path}.presentation must be an object.`);
      } else {
        if (typeof presentation.scene !== "string" || !presentation.scene) errors.push(`${path}.presentation.scene is required.`);
        else if (!ids.scenes.has(presentation.scene)) errors.push(`${path}.presentation.scene references a missing scene.`);
        if (presentation.clip && !ids.clips.has(presentation.clip)) errors.push(`${path}.presentation.clip references a missing clip.`);
        if (presentation.timeline && !ids.timelines.has(presentation.timeline)) errors.push(`${path}.presentation.timeline references a missing timeline.`);
        if (!Number.isFinite(presentation.start) || presentation.start < 0) errors.push(`${path}.presentation.start must be 0 or greater.`);
        if (!Number.isFinite(presentation.end) || presentation.end <= presentation.start) errors.push(`${path}.presentation.end must be greater than start.`);
        for (const key of ["x", "y", "width", "height"]) {
          if (!Number.isFinite(presentation[key]) || presentation[key] < 0 || presentation[key] > 1) {
            errors.push(`${path}.presentation.${key} must be between 0 and 1.`);
          }
        }
      }
    }
    if (!COMPONENT_KINDS.has(component?.kind)) errors.push(`${path}.kind must be tooltip, card, choice, or form.`);
    if (component?.kind === "tooltip" && typeof component.text !== "string") errors.push(`${path}.text is required for a tooltip.`);
    if (component?.kind === "card" && typeof component.title !== "string" && typeof component.text !== "string") errors.push(`${path} needs a title or text.`);
    if (component?.kind === "choice" && (!Array.isArray(component.options) || component.options.length < 2 || component.options.length > 4)) {
      errors.push(`${path}.options must contain 2 to 4 choices.`);
    }
    if (component?.kind === "choice" && Array.isArray(component.options)) {
      component.options.forEach((option, optionIndex) => {
        if (typeof option?.label !== "string") errors.push(`${path}.options[${optionIndex}].label is required.`);
        if (!option?.actions && !option?.action) errors.push(`${path}.options[${optionIndex}] needs an action or actions.`);
      });
    }
    if (component?.kind === "form") {
      if (!Array.isArray(component.fields)) errors.push(`${path}.fields must be an array.`);
      if (!component.on_submit) errors.push(`${path}.on_submit is required for a form.`);
      const fieldNames = new Set();
      (component.fields || []).forEach((field, fieldIndex) => {
        if (typeof field?.name !== "string" || !field.name) errors.push(`${path}.fields[${fieldIndex}].name is required.`);
        else if (fieldNames.has(field.name)) errors.push(`${path}.fields[${fieldIndex}].name "${field.name}" is duplicated.`);
        else fieldNames.add(field.name);
        if (field?.type === "choice" && (!Array.isArray(field.options) || field.options.length < 1)) {
          errors.push(`${path}.fields[${fieldIndex}].options is required for a choice field.`);
        }
      });
    }
    const acceptsResponse = ["card", "choice", "form"].includes(component?.kind);
    const hasResponsePolicy = !!component && Object.hasOwn(component, "response_policy");
    if (acceptsResponse && presentation === undefined) {
      errors.push(`${path}.presentation is required for card, choice, and form components.`);
    }
    if (acceptsResponse && !hasResponsePolicy) {
      errors.push(`${path}.response_policy is required for card, choice, and form components.`);
    }
    if (hasResponsePolicy) {
      const policy = component.response_policy;
      if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
        errors.push(`${path}.response_policy must be an object.`);
      } else {
        if (!["interaction", "layer_end"].includes(policy.dispatch)) {
          errors.push(`${path}.response_policy.dispatch must be "interaction" or "layer_end".`);
        }
        if (!["continue", "pause"].includes(policy.unanswered)) {
          errors.push(`${path}.response_policy.unanswered must be "continue" or "pause".`);
        }
        const unsupported = Object.keys(policy).filter((key) => !["dispatch", "unanswered"].includes(key));
        if (unsupported.length) {
          errors.push(`${path}.response_policy contains unsupported fields: ${unsupported.join(", ")}.`);
        }
      }
      if (!acceptsResponse) {
        errors.push(`${path}.response_policy is only available for card, choice, or form components.`);
      }
      if (component?.kind === "card" && policy?.unanswered === "pause" && !(component.actions?.length > 0)) {
        errors.push(`${path} cannot pause for a response without at least one Card button.`);
      }
    }
  }
  if (manifest.initial_scene && !ids.scenes.has(manifest.initial_scene)) {
    errors.push(`initial_scene references missing scene "${manifest.initial_scene}".`);
  }

  for (const [index, scene] of (manifest.scenes || []).entries()) {
    if (scene.next && !ids.scenes.has(scene.next)) errors.push(`scenes[${index}].next references missing scene "${scene.next}".`);
    validateActions(scene.on_enter, `scenes[${index}].on_enter`, errors, warnings, ids);
    validateActions(scene.on_exit, `scenes[${index}].on_exit`, errors, warnings, ids);
  }
  for (const [index, component] of (manifest.components || []).entries()) {
    for (const [optionIndex, option] of (component.options || []).entries()) {
      validateActions(option.actions || option.action, `components[${index}].options[${optionIndex}].actions`, errors, warnings, ids);
    }
    validateActions(component.on_submit, `components[${index}].on_submit`, errors, warnings, ids);
    if (component.kind === "card" && component.actions !== undefined && !Array.isArray(component.actions)) {
      errors.push(`components[${index}].actions must be an array of Card buttons.`);
    } else if (component.kind === "card" && Array.isArray(component.actions)) {
      component.actions.forEach((button, buttonIndex) => {
        const path = `components[${index}].actions[${buttonIndex}]`;
        if (!button || typeof button !== "object" || Array.isArray(button) || (button.action == null && button.actions == null)) {
          errors.push(`${path} must be a Card button with an action or actions.`);
          return;
        }
        if (typeof button.label !== "string") errors.push(`${path}.label is required.`);
        if (button.action != null && button.actions != null) errors.push(`${path} must use action or actions, not both.`);
        validateActions(button.actions ?? button.action, `${path}.action`, errors, warnings, ids);
      });
    } else validateActions(component.actions, `components[${index}].actions`, errors, warnings, ids);
  }
  for (const [index, hotspot] of (manifest.hotspots || []).entries()) {
    const path = `hotspots[${index}]`;
    if (!hotspot?.id) errors.push(`${path}.id is required.`);
    else if (ids.hotspots.has(hotspot.id)) errors.push(`${path}.id "${hotspot.id}" is duplicated.`);
    else ids.hotspots.add(hotspot.id);
    if (hotspot.scene && !ids.scenes.has(hotspot.scene)) errors.push(`${path}.scene references missing scene "${hotspot.scene}".`);
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(hotspot?.[key]) || hotspot[key] < 0 || hotspot[key] > 1) {
        errors.push(`${path}.${key} must be between 0 and 1.`);
      }
    }
    if ((hotspot?.x || 0) + (hotspot?.width || 0) > 1.000001) errors.push(`${path} extends beyond the right edge.`);
    if ((hotspot?.y || 0) + (hotspot?.height || 0) > 1.000001) errors.push(`${path} extends beyond the bottom edge.`);
    if (!hotspot.actions) errors.push(`${path}.actions is required.`);
    const hotspotScene = (manifest.scenes || []).find((scene) => scene.id === hotspot.scene);
    if (hotspotScene && Number.isFinite(hotspot.start) && hotspot.start < hotspotScene.start) errors.push(`${path}.start is before its scene.`);
    if (hotspotScene && Number.isFinite(hotspot.end) && hotspot.end > hotspotScene.end) errors.push(`${path}.end is after its scene.`);
    validateActions(hotspot.actions, `${path}.actions`, errors, warnings, ids);
  }
  for (const [index, trigger] of (manifest.triggers || []).entries()) {
    if (trigger.scene && !ids.scenes.has(trigger.scene)) errors.push(`triggers[${index}].scene references a missing scene.`);
    if (!Number.isFinite(trigger.at) || trigger.at < 0) errors.push(`triggers[${index}].at must be 0 or greater.`);
    const triggerScene = (manifest.scenes || []).find((scene) => scene.id === trigger.scene);
    if (triggerScene && Number.isFinite(trigger.at) && (trigger.at < triggerScene.start || trigger.at > triggerScene.end)) {
      errors.push(`triggers[${index}].at must fall inside scene "${trigger.scene}".`);
    }
    validateActions(trigger.actions, `triggers[${index}].actions`, errors, warnings, ids);
  }
  validateManifestAnimation(manifest, errors);
  if ((manifest.hotspots || []).length === 0) warnings.push("This manifest has no hotspots.");
  return { valid: errors.length === 0, errors, warnings };
}
