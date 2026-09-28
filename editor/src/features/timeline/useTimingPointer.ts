import { beginAudioTimingDrag } from "../../state/editing/audioCommands";
import { useEffect, useRef, type PointerEvent } from "react";
import { beginComponentTimingDrag } from "../../state/components/componentTimingDrag";
import {
  beginTimelineTimingDrag,
  type TimelineTimingTarget,
} from "../../state/editing/timelineTimingDrag";

type Target =
  | { kind: "audio"; id: number; mode: "move" | "l" | "r" }
  | TimelineTimingTarget
  | { kind: "component"; id: string; mode: "move" | "start" | "end" };
type Transaction =
  | NonNullable<ReturnType<typeof beginAudioTimingDrag>>
  | NonNullable<ReturnType<typeof beginComponentTimingDrag>>
  | NonNullable<ReturnType<typeof beginTimelineTimingDrag>>;

export function useTimingPointer(pixelsPerSecond: number) {
  const gesture = useRef<{
    pointerId: number;
    element: HTMLElement;
    x: number;
    scale: number;
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
    begin(event: PointerEvent<HTMLElement>, target: Target) {
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
      const scale = element.offsetWidth
        ? element.getBoundingClientRect().width / element.offsetWidth
        : 1;
      gesture.current = {
        pointerId: event.pointerId,
        element,
        x: event.clientX,
        scale,
        transaction,
      };
      element.setPointerCapture(event.pointerId);
    },
    move(event: PointerEvent<HTMLElement>) {
      const active = gesture.current;
      if (active?.pointerId === event.pointerId)
        active.transaction.update(
          (event.clientX - active.x) / active.scale / pixelsPerSecond,
        );
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
