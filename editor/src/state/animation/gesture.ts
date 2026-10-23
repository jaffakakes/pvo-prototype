import type {
  AnimationGroup,
  AuthoringValue,
} from "../../domain/animation/authoring";
import {
  changeAuthoringAnimation,
  type AuthoringChange,
} from "../../domain/animation/authoringEdits";
import {
  changeLayerAnimation,
  replaceLayerAnimation,
  KEYFRAME_TIME_EPSILON,
} from "../../domain/animation/editing";
import type { AnimationTarget } from "../../domain/animation/model";
import { getAnimationTarget } from "../../domain/animation/targets";
import {
  layerTrackingData,
  setLayerTracking,
} from "../../domain/animation/trackingMetadata";
import type { Scene } from "../../domain/project/model";
import { useCapture } from "../captureStore";
import {
  projectSnapshot,
  commitGestureHistory,
  ownsHistory,
} from "../project/history";
import {
  canAuthorAnimation,
  sameAnimationTarget,
  selectedAuthoringTarget,
} from "./access";
import { useAnimationSelection } from "./selection";

/** A gesture previews only owned curves, then commits one complete project history snapshot. */
export function beginAnimationGesture(target: AnimationTarget) {
  const before = useCapture.getState();
  const scene = before.scenes.find((item) => item.id === before.currentSceneId);
  const info = scene && getAnimationTarget(scene, target);
  if (!canAuthorAnimation(before) || !scene || !info) return null;
  const snapshot = projectSnapshot(before);
  const originalTracking = layerTrackingData(scene, target);
  const animationState = (value: Scene) =>
    JSON.stringify({
      animation: getAnimationTarget(value, target)?.animation,
      tracking: layerTrackingData(value, target),
    });
  const originalAnimation = animationState(scene);
  const originalSelection = useAnimationSelection.getState().selection;
  let expectedScenes = before.scenes;
  let expectedTime = before.t;
  let expectedAnimation = originalAnimation;
  let ended = false;
  let touched = false;
  const active = () => {
    const state = useCapture.getState();
    return (
      !ended &&
      canAuthorAnimation(state) &&
      state.localId === before.localId &&
      state.currentSceneId === scene.id &&
      ownsHistory(state, before) &&
      state.scenes === expectedScenes &&
      state.ratio === before.ratio &&
      state.allowedDomains === before.allowedDomains
    );
  };
  const restore = () => {
    const state = useCapture.getState();
    if (!touched || state.localId !== before.localId) return;
    const current = state.scenes.find((item) => item.id === scene.id);
    const currentInfo = current && getAnimationTarget(current, target);
    if (
      !current ||
      !currentInfo ||
      animationState(current) !== expectedAnimation
    )
      return;
    let restored = info.animation
      ? replaceLayerAnimation(current, target, info.animation)
      : changeLayerAnimation(current, target, { kind: "clear" });
    if (target.kind !== "audio" && target.kind !== "music")
      restored = setLayerTracking(restored, target, originalTracking);
    state.patch({
      scenes: state.scenes.map((item) =>
        item.id === scene.id ? restored : item,
      ),
      playing: false,
    });
  };
  const preview = (change: AuthoringChange, fromBaseline: boolean): boolean => {
    if (!active()) return false;
    const state = useCapture.getState();
    const current = state.scenes.find((item) => item.id === scene.id)!;
    const result = changeAuthoringAnimation(
      fromBaseline ? scene : current,
      target,
      change,
    );
    expectedAnimation = animationState(result.scene);
    touched = touched || expectedAnimation !== originalAnimation;
    state.patch({
      scenes: state.scenes.map((item) =>
        item.id === scene.id ? result.scene : item,
      ),
      t: result.time,
      playing: false,
    });
    useAnimationSelection.getState().select({
      sceneId: scene.id,
      target,
      group: result.group,
      time: result.time,
    });
    expectedScenes = useCapture.getState().scenes;
    expectedTime = result.time;
    return true;
  };
  return {
    setValue(
      group: AnimationGroup,
      time: number,
      value: AuthoringValue,
      wholeTransform = false,
    ): boolean {
      return preview(
        { kind: "value", group, time, value, options: { wholeTransform } },
        false,
      );
    },
    /** from always identifies the original key at pointer-down, even after multiple previews. */
    moveKey(
      group: AnimationGroup,
      from: number,
      to: number,
      wholeTransform = false,
    ): boolean {
      return preview(
        { kind: "move", group, from, to, options: { wholeTransform } },
        true,
      );
    },
    commit() {
      if (ended) return;
      if (!active()) {
        restore();
        ended = true;
        return;
      }
      if (expectedAnimation !== originalAnimation) {
        const selection = useAnimationSelection.getState().selection;
        const state = useCapture.getState();
        commitGestureHistory(state, before, snapshot, { playing: false });
        if (selection) useAnimationSelection.getState().select(selection);
      }
      ended = true;
    },
    cancel() {
      if (ended) return;
      const state = useCapture.getState();
      const selection = useAnimationSelection.getState().selection;
      const ownsSelection =
        selection?.sceneId === scene.id &&
        sameAnimationTarget(selection.target, target);
      const restoreSelection =
        active() &&
        sameAnimationTarget(selectedAuthoringTarget(state), target) &&
        Math.abs(state.t - expectedTime) < KEYFRAME_TIME_EPSILON;
      restore();
      ended = true;
      // Navigation owns its new layer/playhead. Rolling back curves must not select the old one again.
      if (
        restoreSelection &&
        originalSelection?.sceneId === scene.id &&
        sameAnimationTarget(originalSelection.target, target) &&
        Math.abs(originalSelection.time - before.t) < KEYFRAME_TIME_EPSILON
      )
        useAnimationSelection.getState().select(originalSelection);
      else if (ownsSelection) useAnimationSelection.getState().clear();
    },
  };
}
