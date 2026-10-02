import type { AnimationGroup, AuthoringOptions, AuthoringValue } from "../../domain/animation/authoring";
import { changeAuthoringAnimation, changeAuthoringFade, type AuthoringChange } from "../../domain/animation/authoringEdits";
import type { AnimationEasing, AnimationTarget } from "../../domain/animation/model";
import { useCapture } from "../captureStore";
import { canAuthorAnimation, sameAnimationTarget, selectedAuthoringTarget } from "./access";
import { useAnimationSelection } from "./selection";

export { selectedAuthoringTarget } from "./access";
export { beginAnimationGesture } from "./gesture";

function apply(target: AnimationTarget, change: AuthoringChange): boolean {
  const state = useCapture.getState();
  if (!canAuthorAnimation(state)) return false;
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  if (!scene) return false;
  const result = changeAuthoringAnimation(scene, target, change);
  if (result.scene !== scene) state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? result.scene : item), playing: false });
  else if (state.playing) state.patch({ playing: false });
  if (change.kind === "remove") useAnimationSelection.getState().clear();
  else useAnimationSelection.getState().select({ sceneId: scene.id, target, group: result.group, time: result.time });
  return result.scene !== scene;
}

export function addAuthoringKey(target: AnimationTarget, time: number, options: AuthoringOptions = {}): boolean {
  return apply(target, { kind: "add", time, options });
}
export function removeAuthoringKey(target: AnimationTarget, time: number, options: AuthoringOptions = {}): boolean {
  return apply(target, { kind: "remove", time, options });
}
export function moveAuthoringKey(target: AnimationTarget, group: AnimationGroup, from: number, to: number, options: AuthoringOptions = {}): boolean {
  return apply(target, { kind: "move", group, from, to, options });
}
export function setAuthoringValue(target: AnimationTarget, group: AnimationGroup, time: number, value: AuthoringValue, options: AuthoringOptions = {}): boolean {
  return apply(target, { kind: "value", group, time, value, options });
}
export function setAuthoringEasing(target: AnimationTarget, group: AnimationGroup, time: number, easing: AnimationEasing, options: AuthoringOptions = {}): boolean {
  return apply(target, { kind: "easing", group, time, easing, options });
}
export function addSelectedAuthoringKey(): boolean {
  const state = useCapture.getState();
  const target = selectedAuthoringTarget(state);
  return target ? addAuthoringKey(target, state.t) : false;
}

/** True means the valid selected key consumed Delete, so the caller must not delete the layer. */
export function deleteSelectedAuthoringKey(): boolean {
  const state = useCapture.getState();
  const selection = useAnimationSelection.getState().selection;
  if (!selection || selection.sceneId !== state.currentSceneId || !sameAnimationTarget(selectedAuthoringTarget(state), selection.target)) return false;
  removeAuthoringKey(selection.target, selection.time, { group: selection.group });
  return true;
}

export function fadeAuthoringVolume(target: AnimationTarget, direction: "in" | "out"): boolean {
  const state = useCapture.getState();
  if (!canAuthorAnimation(state)) return false;
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  if (!scene) return false;
  const next = changeAuthoringFade(scene, target, direction);
  if (JSON.stringify(next) === JSON.stringify(scene)) return false;
  state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? next : item), playing: false });
  useAnimationSelection.getState().clear();
  return true;
}
