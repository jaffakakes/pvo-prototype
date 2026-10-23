import type { PointerEvent } from "react";
import type { TextOverlay, PvoComponent } from "../../domain/project/model";
import { componentLength } from "../../domain/components/timing";
import { useCapture } from "../../state/captureStore";
import { useLayerPointer } from "./useLayerPointer";
import type { useLayerDrag } from "./useLayerDrag";
import { PPS } from "./geometry";

export function useTimelineLayerTiming(
  layerDrag: ReturnType<typeof useLayerDrag>,
) {
  const pointer = useLayerPointer(layerDrag, PPS, {
    enabled: true,
    playhead: useCapture((state) => state.t),
  });
  const side = (event: PointerEvent) =>
    (event.target as HTMLElement).closest<HTMLElement>(".compHandle")?.dataset
      .side;
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const active = pointer.end(event);
    if (
      active &&
      event.type === "pointerup" &&
      !active.moved &&
      active.selected &&
      active.id.startsWith("text:") &&
      !["crop", "keyframes"].includes(useCapture.getState().sheet ?? "")
    )
      useCapture.getState().patch({ sheet: "text" });
  };
  return {
    compDown(event: PointerEvent<HTMLButtonElement>, component: PvoComponent) {
      const edge = side(event);
      const mode = edge === "l" || edge === "r" ? edge : "move";
      pointer.begin(
        event,
        `component:${component.id}`,
        mode,
        mode === "l"
          ? component.at
          : mode === "r"
            ? component.at +
              componentLength(component, useCapture.getState().clips)
            : null,
      );
    },
    compMove: pointer.move,
    compUp: end,
    textBarDown(event: PointerEvent<HTMLButtonElement>, text: TextOverlay) {
      const edge = side(event);
      const mode = edge === "l" || edge === "r" ? edge : "move";
      pointer.begin(
        event,
        `text:${text.id}`,
        mode,
        mode === "l" ? text.start : mode === "r" ? text.end : null,
      );
    },
    textBarMove: pointer.move,
    textBarUp: end,
  };
}
