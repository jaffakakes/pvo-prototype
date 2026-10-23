import { useRef, type PointerEvent } from "react";
import type { LayerId } from "../../domain/layers/model";
import {
  beginLayerTimingDrag,
  type LayerTimingMode,
} from "../../state/editing/layerTimingCommands";
import {
  selectedLayerId,
  selectTimelineLayer,
} from "../../state/editing/layerSelection";
import { useCapture } from "../../state/captureStore";
import { useGestureCancellation } from "./useGestureCancellation";
import { snappedTimingDelta, type TimingSnapSettings } from "./timingSnap";
import type { useLayerDrag } from "./useLayerDrag";

type Timing = NonNullable<ReturnType<typeof beginLayerTimingDrag>>;
export function useLayerPointer(
  layerDrag: ReturnType<typeof useLayerDrag> | undefined,
  pixelsPerSecond: number,
  snap?: TimingSnapSettings,
) {
  const gesture = useRef<{
    id: LayerId;
    mode: LayerTimingMode;
    pointerId: number;
    element: HTMLElement;
    x: number;
    scale: number;
    edge: number | null;
    playhead: number;
    timing: Timing | null;
    moved: boolean;
    selected: boolean;
  } | null>(null);
  const finish = (cancelled: boolean) => {
    const active = gesture.current;
    if (!active) return null;
    gesture.current = null;
    layerDrag?.end(cancelled);
    if (cancelled) active.timing?.cancel();
    else active.timing?.commit();
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    return active;
  };
  useGestureCancellation(() => !!finish(true));
  return {
    begin(
      event: PointerEvent<HTMLElement>,
      id: LayerId,
      mode: LayerTimingMode,
      edge: number | null = null,
    ) {
      event.stopPropagation();
      const state = useCapture.getState();
      if (
        event.button > 0 ||
        state.tryMode ||
        state.playheadPick ||
        gesture.current
      )
        return;
      const element = event.currentTarget;
      const width = parseFloat(getComputedStyle(element).width);
      const selected = selectedLayerId(state) === id;
      selectTimelineLayer(id);
      if (mode === "move") layerDrag?.begin(id, event);
      gesture.current = {
        id,
        mode,
        element,
        pointerId: event.pointerId,
        x: event.clientX,
        scale: width > 0 ? element.getBoundingClientRect().width / width : 1,
        edge,
        playhead: state.t,
        timing: null,
        moved: false,
        selected,
      };
      element.setPointerCapture(event.pointerId);
    },
    move(event: PointerEvent<HTMLElement>) {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      if (active.mode === "move" && layerDrag) {
        const axis = layerDrag.move(event);
        if (axis !== "time") {
          if (axis === "layer") active.moved = true;
          return;
        }
      }
      const dx = (event.clientX - active.x) / active.scale;
      const result =
        snap?.enabled && active.edge != null
          ? snappedTimingDelta(
              active.edge,
              dx / pixelsPerSecond,
              active.playhead,
              pixelsPerSecond,
              true,
            )
          : { delta: dx / pixelsPerSecond, snapped: false };
      if (!active.moved && Math.abs(dx) < 3 && !result.snapped) return;
      active.moved = true;
      active.timing ??= beginLayerTimingDrag(active.id, active.mode);
      if (!active.timing?.update(result.delta)) finish(true);
    },
    end(event: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointerId !== event.pointerId) return null;
      event.stopPropagation();
      if (
        event.type === "lostpointercapture" &&
        event.target !== event.currentTarget
      )
        return null;
      return finish(
        event.type === "pointercancel" || event.type === "lostpointercapture",
      );
    },
  };
}
