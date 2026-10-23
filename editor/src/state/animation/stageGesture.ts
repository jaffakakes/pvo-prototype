import {
  getAuthoringLayer,
  readAuthoringValue,
} from "../../domain/animation/authoring";
import {
  constrainOverlayPosition,
  type OverlayTarget,
  type OverlayTransform,
} from "../../domain/layers/transform";
import { useCapture } from "../captureStore";
import { beginAnimationGesture } from "./commands";

export type StageAnimationTarget = OverlayTarget | { kind: "clip"; id: number };
export type StageTransform = OverlayTransform & { rotation: number };

/** Keep pointer authoring on the same commands and history transaction as controls. */
export function beginStageAnimationTransform(
  target: StageAnimationTarget,
  wholeTransform: boolean,
) {
  const state = useCapture.getState();
  const scene = state.scenes.find((item) => item.id === state.currentSceneId);
  if (!scene) return null;
  const layer = getAuthoringLayer(scene, target);
  if (!layer || state.t < layer.start || state.t > layer.end) return null;
  const position = readAuthoringValue(scene, target, "position", state.t);
  const scale = readAuthoringValue(scene, target, "scale", state.t);
  const rotation = readAuthoringValue(scene, target, "rotation", state.t);
  if (
    typeof position === "number" ||
    typeof scale !== "number" ||
    typeof rotation !== "number"
  )
    return null;
  const transaction = beginAnimationGesture(target);
  if (!transaction) return null;
  const time = state.t;
  let current: StageTransform = { ...position, size: scale, rotation };
  return {
    value: () => current,
    update(value: OverlayTransform & { rotation?: number }) {
      const position = constrainOverlayPosition(value);
      if (position.x !== current.x || position.y !== current.y) {
        if (!transaction.setValue("position", time, position, wholeTransform))
          return false;
      }
      if (value.size !== current.size) {
        if (!transaction.setValue("scale", time, value.size, wholeTransform))
          return false;
      }
      if (value.rotation !== undefined && value.rotation !== current.rotation) {
        if (
          !transaction.setValue(
            "rotation",
            time,
            value.rotation,
            wholeTransform,
          )
        )
          return false;
      }
      const latest = useCapture
        .getState()
        .scenes.find((item) => item.id === scene.id);
      const scale = latest && readAuthoringValue(latest, target, "scale", time);
      const rotation =
        latest && readAuthoringValue(latest, target, "rotation", time);
      current = {
        ...position,
        size: typeof scale === "number" ? scale : value.size,
        rotation: typeof rotation === "number" ? rotation : current.rotation,
      };
      return true;
    },
    commit: () => transaction.commit(),
    cancel: () => transaction.cancel(),
  };
}
