import { beginAudioTimingDrag } from "../../state/editing/audioCommands";
import { useEffect, useRef, type PointerEvent } from "react";
import { beginComponentTimingDrag } from "../../state/components/componentTimingDrag";
import {
  beginTimelineTimingDrag,
  type TimelineTimingTarget,
} from "../../state/editing/timelineTimingDrag";
import {
  snappedTimingDelta,
  type TimingSnapSettings,
} from "./timingSnap";

type Target =
  | { kind: "audio"; id: number; mode: "move" | "l" | "r" }
  | TimelineTimingTarget
  | { kind: "component"; id: string; mode: "move" | "start" | "end" };
type Transaction = {
  update(delta: number, exact?: boolean): boolean;
  commit(): void;
  cancel(): void;
};

export function useTimingPointer(
  pixelsPerSecond: number,
  snap?: TimingSnapSettings,
) {
  const gesture = useRef<{
    pointerId: number;
    element: HTMLElement;
    x: number;
    scale: number;
    pixelsPerSecond: number;
    snap: { edgeTime: number; playhead: number } | null;
    transaction: Transaction;
  } | null>(null);
  useEffect(() => {
    const cancel = () => {
      const active = gesture.current;
      gesture.current = null;
      active?.transaction.cancel();
      if (active?.element.hasPointerCapture(active.pointerId))
        active.element.releasePointerCapture(active.pointerId);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  return {
    begin(
      event: PointerEvent<HTMLElement>,
      target: Target,
      edgeTime?: number,
    ) {
      event.stopPropagation();
      if (event.button > 0 || gesture.current) return;
      const transaction =
        target.kind === "audio"
          ? beginAudioTimingDrag(target.id, target.mode)
          : target.kind === "component"
            ? beginComponentTimingDrag(target.id, target.mode)
            : beginTimelineTimingDrag(target);
      if (!transaction) return;
      const element = event.currentTarget;
      const renderedWidth = element.getBoundingClientRect().width;
      const layoutWidth = Number.parseFloat(getComputedStyle(element).width);
      const scale = layoutWidth > 0 ? renderedWidth / layoutWidth : 1;
      gesture.current = {
        pointerId: event.pointerId,
        element,
        x: event.clientX,
        scale,
        pixelsPerSecond,
        snap:
          snap?.enabled && edgeTime != null
            ? { edgeTime, playhead: snap.playhead }
            : null,
        transaction,
      };
      element.setPointerCapture(event.pointerId);
    },
    move(event: PointerEvent<HTMLElement>) {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      const delta =
        (event.clientX - active.x) /
        active.scale /
        active.pixelsPerSecond;
      const result = active.snap
        ? snappedTimingDelta(
            active.snap.edgeTime,
            delta,
            active.snap.playhead,
            active.pixelsPerSecond,
            true,
          )
        : { delta, snapped: false };
      active.transaction.update(result.delta, result.snapped);
    },
    end(event: PointerEvent<HTMLElement>) {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      gesture.current = null;
      if (event.type === "pointercancel" || event.type === "lostpointercapture")
        active?.transaction.cancel();
      else active?.transaction.commit();
    },
  };
}
