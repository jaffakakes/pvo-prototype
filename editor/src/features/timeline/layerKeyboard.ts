import type { KeyboardEvent } from "react";
import type { LayerId } from "../../domain/layers/model";
import { useCapture } from "../../state/captureStore";
export function reorderLayerKey(event: KeyboardEvent) {
  const state = useCapture.getState();
  if (
    !event.altKey ||
    !["ArrowUp", "ArrowDown"].includes(event.key) ||
    state.tryMode ||
    state.playheadPick
  )
    return;
  const element = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-layer-id],[data-reorder-layer]",
  );
  const id = (element?.dataset.layerId ?? element?.dataset.reorderLayer) as
    LayerId | undefined;
  if (!id) return;
  event.preventDefault();
  event.stopPropagation();
  state.reorderLayer(id, event.key === "ArrowUp" ? "up" : "down");
}
