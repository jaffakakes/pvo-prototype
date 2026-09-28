import { moveLayer } from "../../domain/layers/order";
import type { CaptureState } from "../types";

export function createLayerActions(get: () => CaptureState): Pick<CaptureState, "reorderLayer"> {
  return {
    reorderLayer: (id, direction) => {
      const state = get();
      const layers = moveLayer(state, id, direction);
      if (layers.join() !== state.layers.join())
        state.edit({ layers });
    }
  };
}
