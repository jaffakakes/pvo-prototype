import { getAuthoringLayer, readAuthoringValue } from "../../domain/animation/authoring";
import { constrainOverlayPosition, type OverlayTarget, type OverlayTransform } from "../../domain/layers/transform";
import { useCapture } from "../captureStore";
import { beginAnimationGesture } from "./commands";

export type StageAnimationTarget = OverlayTarget | { kind: "clip"; id: number };

/** Keep pointer authoring on the same commands and history transaction as controls. */
export function beginStageAnimationTransform(target: StageAnimationTarget, wholeTransform: boolean) {
  const state = useCapture.getState();
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  if (!scene) return null;
  const layer = getAuthoringLayer(scene, target);
  if (!layer || state.t < layer.start || state.t > layer.end) return null;
  const position = readAuthoringValue(scene, target, "position", state.t);
  const scale = readAuthoringValue(scene, target, "scale", state.t);
  if (typeof position === "number" || typeof scale !== "number") return null;
  const transaction = beginAnimationGesture(target);
  if (!transaction) return null;
  const time = state.t;
  let current: OverlayTransform = { ...position, size: scale };
  return {
    value: () => current,
    update(value: OverlayTransform) {
      const position = constrainOverlayPosition(value);
      if (position.x !== current.x || position.y !== current.y) {
        if (!transaction.setValue("position", time, position, wholeTransform)) return false;
      }
      if (value.size !== current.size) {
        if (!transaction.setValue("scale", time, value.size, wholeTransform)) return false;
      }
      const latest = useCapture.getState().scenes.find(item => item.id === scene.id);
      const scale = latest && readAuthoringValue(latest, target, "scale", time);
      current = { ...position, size: typeof scale === "number" ? scale : value.size };
      return true;
    },
    commit: () => transaction.commit(),
    cancel: () => transaction.cancel(),
  };
}
