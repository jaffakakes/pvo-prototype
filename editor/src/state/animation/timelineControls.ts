import { getAuthoringLayer } from "../../domain/animation/authoring";
import type { AnimationEasing } from "../../domain/animation/model";
import {
  timelineAnimationKeys,
  timelineAnimationSegment,
} from "../../domain/animation/timeline";
import { KEYFRAME_TIME_EPSILON } from "../../domain/animation/editing";
import { useCapture } from "../captureStore";
import type { CaptureState } from "../types";
import { canAuthorAnimation, selectedAuthoringTarget } from "./access";
import { useAnimationSelection } from "./selection";
import {
  addAuthoringKey,
  removeAuthoringKey,
  setAuthoringEasing,
} from "./commands";

export function selectedTimelineAnimation(state: CaptureState) {
  const target = selectedAuthoringTarget(state);
  const scene = state.scenes.find((item) => item.id === state.currentSceneId);
  const layer = scene && target && getAuthoringLayer(scene, target);
  if (!scene || !target || !layer) return null;
  const audio =
    layer.audio ||
    state.sheet === "volume" ||
    state.sheet === "volumeKeyframes";
  const keys = timelineAnimationKeys(scene, target, audio);
  return {
    target,
    layer,
    audio,
    keys,
    segment: timelineAnimationSegment(keys, state.t),
    here: keys.find(
      (key) => Math.abs(key.time - state.t) < KEYFRAME_TIME_EPSILON,
    ),
    disabled:
      !canAuthorAnimation(state) ||
      state.t < layer.start - KEYFRAME_TIME_EPSILON ||
      state.t > layer.end + KEYFRAME_TIME_EPSILON,
  };
}

export function toggleTimelineKeyframe() {
  const state = useCapture.getState();
  const model = selectedTimelineAnimation(state);
  if (!model || model.disabled) return false;
  const options = {
    wholeTransform: !model.audio,
    ...(model.audio ? { group: "volume" as const } : {}),
  };
  return model.here
    ? removeAuthoringKey(model.target, state.t, options)
    : addAuthoringKey(model.target, state.t, options);
}

export function toggleTimelineGraphs() {
  const state = useCapture.getState();
  const model = selectedTimelineAnimation(state);
  if (!model || model.disabled) return false;
  state.patch({
    sheet:
      state.sheet === "keyframes" || state.sheet === "volumeKeyframes"
        ? null
        : model.audio
          ? "volumeKeyframes"
          : "keyframes",
    playing: false,
  });
  return true;
}

export function setTimelineEasing(easing: AnimationEasing) {
  const state = useCapture.getState();
  const model = selectedTimelineAnimation(state);
  if (!model || model.disabled || !model.segment?.next) return false;
  return setAuthoringEasing(
    model.target,
    model.segment.key.group,
    model.segment.key.time,
    easing,
    { wholeTransform: !model.audio },
  );
}

export function selectTimelineKeyframe(time: number) {
  const state = useCapture.getState();
  const model = selectedTimelineAnimation(state);
  const key = model?.keys.find(
    (key) => Math.abs(key.time - time) < KEYFRAME_TIME_EPSILON,
  );
  if (!model || !key || !canAuthorAnimation(state)) return false;
  useAnimationSelection.getState().select({
    sceneId: state.currentSceneId,
    target: model.target,
    group: key.group,
    time: key.time,
  });
  return true;
}
