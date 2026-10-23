import type { StageAnimationTarget } from "../animation/stageGesture";
import { canAuthorAnimation } from "../animation/access";
import { useCapture } from "../captureStore";
import { resetLayerTransform } from "../../domain/layers/transform";

export function resetSelectedLayerTransform(target: StageAnimationTarget) {
  const state = useCapture.getState();
  if (!canAuthorAnimation(state)) return;
  const scene = state.scenes.find((item) => item.id === state.currentSceneId);
  if (!scene) return;
  const updated = resetLayerTransform(scene, target);
  if (updated !== scene)
    state.edit({
      clips: updated.clips,
      texts: updated.texts,
      components: updated.components,
    });
}
