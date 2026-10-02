import type { NativeVisualAnimationTarget } from "../../../../packages/pvo-assistant/native/index.js";
import { refitTrackedAnimation } from "../../domain/animation/trackedAuthoring";
import { getLayerTracking, setLayerTracking, type TrackingStep } from "../../domain/animation/trackingMetadata";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";
import { canAuthorAnimation } from "./access";
import { useAnimationSelection } from "./selection";

export function refitLayerTracking(target: NativeVisualAnimationTarget, step: TrackingStep): boolean {
  const state = useCapture.getState();
  if (!canAuthorAnimation(state)) return false;
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  if (!scene) return false;
  const next = refitTrackedAnimation(projectSnapshot(state), target, step);
  if (JSON.stringify(next) === JSON.stringify(scene)) return false;
  state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? next : item), playing: false });
  useAnimationSelection.getState().clear();
  return true;
}

export function detachLayerTracking(target: NativeVisualAnimationTarget): boolean {
  const state = useCapture.getState();
  if (!canAuthorAnimation(state)) return false;
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  if (!scene || !getLayerTracking(scene, target)) return false;
  const next = setLayerTracking(scene, target, undefined);
  state.edit({ scenes: state.scenes.map(item => item.id === scene.id ? next : item), playing: false });
  return true;
}
