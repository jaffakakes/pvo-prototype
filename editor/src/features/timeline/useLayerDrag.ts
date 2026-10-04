import type { PointerEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { type LayerId } from "../../domain/layers/model";
import { beginLayerReorderDrag } from "../../state/editing/layerReorderDrag";
import { dragLayer, timelineRows } from "./geometry";

type Axis = "pending" | "layer" | "time";
type Gesture = {
  id: LayerId;
  order: LayerId[];
  x: number;
  y: number;
  latestY: number;
  scroll: number;
  top: number;
  axis: Axis;
  label: boolean;
  transaction: NonNullable<ReturnType<typeof beginLayerReorderDrag>>;
};
export function useLayerDrag(timeline: RefObject<HTMLDivElement>) {
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const [active, setActive] = useState<{
    id: LayerId;
    top: number;
  } | null>(null);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      gesture.current?.transaction.cancel();
      gesture.current = null;
    },
    [],
  );
  const cancelPreview = () => {
    cancelAnimationFrame(frame.current);
    gesture.current?.transaction.cancel();
    setActive(null);
  };
  const position = () => {
    const drag = gesture.current,
      host = timeline.current;
    if (!drag || !host || drag.axis !== "layer") return;
    const delta = drag.latestY - drag.y + host.scrollTop - drag.scroll;
    const layers = dragLayer(drag.order, drag.id, delta);
    if (!drag.transaction.update(layers)) {
      cancelPreview();
      return false;
    }
    setActive({ id: drag.id, top: Math.max(24, drag.top + delta) });
    return true;
  };
  const scroll = () => {
    const drag = gesture.current,
      host = timeline.current;
    if (!drag || !host || drag.axis !== "layer") return;
    if (!drag.transaction.active()) {
      cancelPreview();
      return;
    }
    const box = host.getBoundingClientRect();
    const edge = 28;
    const speed =
      drag.latestY < box.top + edge
        ? -6
        : drag.latestY > box.bottom - edge
          ? 6
          : 0;
    if (speed) {
      host.scrollTop += speed;
      if (!position()) return;
    }
    frame.current = requestAnimationFrame(scroll);
  };
  const begin = (id: LayerId, event: PointerEvent, label = false) => {
    cancelPreview();
    gesture.current = null;
    const transaction = beginLayerReorderDrag(id);
    if (!transaction) return;
    const order = transaction.order;
    gesture.current = {
      id,
      order,
      x: event.clientX,
      y: event.clientY,
      latestY: event.clientY,
      scroll: timeline.current?.scrollTop ?? 0,
      top: timelineRows(order).find((row) => row.id === id)!.top,
      axis: "pending",
      label,
      transaction,
    };
  };
  const move = (event: PointerEvent): Axis => {
    const drag = gesture.current;
    if (!drag) return "time";
    if (!drag.transaction.active()) {
      cancelPreview();
      // Keep this pointer owned until release so a stale drag cannot become a
      // time gesture in the newly selected scene on its next pointer move.
      return "pending";
    }
    drag.latestY = event.clientY;
    if (drag.axis === "pending") {
      const dx = Math.abs(event.clientX - drag.x),
        dy = Math.abs(event.clientY - drag.y);
      if (Math.max(dx, dy) < 6) return "pending";
      drag.axis = drag.label || dy > dx ? "layer" : "time";
      if (drag.axis === "layer") frame.current = requestAnimationFrame(scroll);
    }
    if (drag.axis === "layer") {
      event.preventDefault();
      position();
    }
    return drag.axis;
  };
  const end = (cancelled = false) => {
    const drag = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    setActive(null);
    if (!drag) return false;
    if (cancelled || drag.axis !== "layer") drag.transaction.cancel();
    else drag.transaction.commit();
    return drag.axis === "layer";
  };
  return { active, begin, move, end };
}
