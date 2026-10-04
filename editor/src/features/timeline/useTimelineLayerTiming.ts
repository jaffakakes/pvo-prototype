import { useRef, type PointerEvent } from "react";
import {
  componentLength,
  type TimingDragMode,
} from "../../domain/components/timing";
import type { PvoComponent, TextOverlay } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { beginComponentTimingDrag } from "../../state/components/componentTimingDrag";
import { beginTimelineTimingDrag } from "../../state/editing/timelineTimingDrag";
import { PPS } from "./geometry";
import { snappedTimingDelta } from "./timingSnap";
import { useGestureCancellation } from "./useGestureCancellation";
import type { useLayerDrag } from "./useLayerDrag";

type Target =
  | { kind: "component"; id: string; mode: TimingDragMode }
  | { kind: "text"; id: number; mode: "move" | "l" | "r" };
type Transaction = {
  update(delta: number): boolean;
  commit(): void;
  cancel(): void;
};
type Gesture = {
  target: Target;
  pointerId: number;
  element: Element;
  x: number;
  timing: Transaction | null;
  selected: boolean;
  moved: boolean;
  edgeTime: number | null;
  playhead: number;
};

/** Chooses layer reordering or time movement; the commands own edits and history. */
export function useTimelineLayerTiming(
  layerDrag: ReturnType<typeof useLayerDrag>,
) {
  const gesture = useRef<Gesture | null>(null);
  const finish = (cancelled: boolean) => {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    layerDrag.end(cancelled);
    if (cancelled) active.timing?.cancel();
    else active.timing?.commit();
    const state = useCapture.getState();
    const exists =
      active.target.kind === "component"
        ? state.components.some((item) => item.id === active.target.id)
        : state.texts.some((item) => item.id === active.target.id);
    if (active.selected && !active.moved && !cancelled && exists) {
      state.patch({
        sheet: active.target.kind === "component" ? "component" : "text",
        playing: false,
        orb: false,
      });
    }
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    return true;
  };
  useGestureCancellation(() => finish(true));

  const begin = (
    event: PointerEvent<HTMLButtonElement>,
    target: Target,
    selected: boolean,
    edgeTime: number | null,
  ) => {
    event.stopPropagation();
    const state = useCapture.getState();
    if (
      event.button > 0 ||
      state.tryMode ||
      state.playheadPick ||
      gesture.current
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (target.mode === "move")
      layerDrag.begin(
        target.kind === "text" ? `text:${target.id}` : `component:${target.id}`,
        event,
      );
    gesture.current = {
      target,
      pointerId: event.pointerId,
      element: event.currentTarget,
      x: event.clientX,
      selected,
      edgeTime,
      playhead: state.t,
      moved: false,
      timing: null,
    };
    state.patch({
      sel: -1,
      selComp: target.kind === "component" ? target.id : null,
      selText: target.kind === "text" ? target.id : null,
      playing: false,
      orb: false,
    });
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    if (active.target.mode === "move") {
      const axis = layerDrag.move(event);
      if (axis !== "time") {
        if (axis === "layer") active.moved = true;
        return;
      }
    }
    const dx = event.clientX - active.x;
    const result =
      active.edgeTime == null
        ? { delta: dx / PPS, snapped: false }
        : snappedTimingDelta(
            active.edgeTime,
            dx / PPS,
            active.playhead,
            PPS,
            true,
          );
    const threshold = active.target.kind === "text" ? 3 : 2;
    if (!active.moved && Math.abs(dx) < threshold && !result.snapped) return;
    active.moved = true;
    if (!active.timing) {
      active.timing =
        active.target.kind === "component"
          ? beginComponentTimingDrag(active.target.id, active.target.mode)
          : beginTimelineTimingDrag(active.target);
    }
    if (!active.timing?.update(result.delta)) finish(true);
  };
  const end = (event: PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    finish(
      event.type === "pointercancel" || event.type === "lostpointercapture",
    );
  };
  const handleSide = (event: PointerEvent) =>
    (event.target as HTMLElement).closest<HTMLElement>(".compHandle")?.dataset
      .side;

  return {
    compDown(event: PointerEvent<HTMLButtonElement>, component: PvoComponent) {
      const side = handleSide(event);
      const mode = side === "l" ? "start" : side === "r" ? "end" : "move";
      const state = useCapture.getState();
      begin(
        event,
        { kind: "component", id: component.id, mode },
        state.selComp === component.id,
        mode === "start"
          ? component.at
          : mode === "end"
            ? component.at + componentLength(component, state.clips)
            : null,
      );
    },
    compMove: move,
    compUp: end,
    textBarDown(event: PointerEvent<HTMLButtonElement>, text: TextOverlay) {
      const side = handleSide(event);
      const mode = side === "l" || side === "r" ? side : "move";
      begin(
        event,
        { kind: "text", id: text.id, mode },
        useCapture.getState().selText === text.id,
        side === "l" ? text.start : side === "r" ? text.end : null,
      );
    },
    textBarMove: move,
    textBarUp: end,
  };
}
