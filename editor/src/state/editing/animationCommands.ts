import { changeLayerAnimation, type AnimationChange } from "../../domain/animation/editing";
import type { AnimationEasing, AnimationProperty, AnimationTarget, LayerAnimation } from "../../domain/animation/model";
import { useAssistant } from "../assistant/assistantStore";
import { useCapture } from "../captureStore";

function apply(target: AnimationTarget, change: AnimationChange): boolean {
  const state = useCapture.getState();
  if (state.screen !== "editor" || state.recording || state.importing || state.tryMode || state.playheadPick
    || state.trim || state.ex === "running" || useAssistant.getState().phase !== "idle") return false;
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  if (!scene) return false;
  const next = changeLayerAnimation(scene, target, change);
  if (next === scene) return false;
  state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? next : item) });
  return true;
}

export function setLayerKeyframe(target: AnimationTarget, property: AnimationProperty, sceneTime: number,
  value: number, easing: AnimationEasing = "linear"): boolean {
  return apply(target, { kind: "set", property, time: sceneTime, value, easing });
}
export function removeLayerKeyframe(target: AnimationTarget, property: AnimationProperty, sceneTime: number): boolean {
  return apply(target, { kind: "remove", property, time: sceneTime });
}
export function moveLayerKeyframe(target: AnimationTarget, property: AnimationProperty, fromSceneTime: number, toSceneTime: number): boolean {
  return apply(target, { kind: "move", property, from: fromSceneTime, to: toSceneTime });
}
export function clearLayerAnimation(target: AnimationTarget, property?: AnimationProperty): boolean {
  return apply(target, { kind: "clear", property });
}
export function setLayerAnimationTracks(target: AnimationTarget, tracks: LayerAnimation["tracks"]): boolean {
  return apply(target, { kind: "tracks", tracks });
}
