import type { LayerId } from "../../domain/layers/model";
import { layerOrder } from "../../domain/layers/order";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";

const sameOrder = (a: readonly LayerId[], b: readonly LayerId[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/** Owns live layer order and its single history entry, scoped to the starting scene. */
export function beginLayerReorderDrag(id: LayerId) {
  const before = useCapture.getState();
  const original = layerOrder(before);
  if (before.tryMode || before.playheadPick || !original.includes(id))
    return null;
  const snapshot = projectSnapshot(before);
  let preview = original;
  let ended = false;
  let invalidated = false;

  const unchangedProjectHistory = () => {
    const state = useCapture.getState();
    return (
      !ended &&
      state.localId === before.localId &&
      state.past === before.past &&
      state.future === before.future
    );
  };
  const ownsPreview = () => {
    const scene = useCapture
      .getState()
      .scenes.find((item) => item.id === before.currentSceneId);
    return !!scene && sameOrder(layerOrder(scene), preview);
  };
  const active = () => {
    const state = useCapture.getState();
    if (
      !unchangedProjectHistory() ||
      state.currentSceneId !== before.currentSceneId ||
      state.tryMode ||
      state.playheadPick ||
      !ownsPreview()
    )
      invalidated = true;
    return !invalidated;
  };
  const restore = () => {
    if (
      unchangedProjectHistory() &&
      ownsPreview() &&
      !sameOrder(preview, original)
    ) {
      // Navigation does not change history. Restore only the scene we previewed,
      // never the newly selected scene or a replacement project's matching ID.
      useCapture
        .getState()
        .updateScene(before.currentSceneId, { layers: original }, false);
    }
  };

  return {
    order: original.slice(),
    active,
    update(layers: LayerId[]) {
      if (!active()) return false;
      if (!sameOrder(layers, preview)) {
        useCapture.getState().patch({ layers });
        preview = layerOrder(useCapture.getState());
      }
      return true;
    },
    commit() {
      if (!active()) {
        restore();
        ended = true;
        return false;
      }
      if (!sameOrder(preview, original)) {
        const state = useCapture.getState();
        state.patch({
          past: [...state.past, snapshot].slice(-40),
          future: [],
        });
      }
      ended = true;
      return true;
    },
    cancel() {
      restore();
      ended = true;
    },
  };
}
