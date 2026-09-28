import type { PointerEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { type LayerId } from "../../domain/layers/model";
import { layerOrder } from "../../domain/layers/order";
import { useCapture } from "../../state/captureStore";
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
};
export function useLayerDrag(timeline: RefObject<HTMLDivElement>) {
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const [active, setActive] = useState<{
    id: LayerId;
    top: number;
  } | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const position = () => {
    const drag = gesture.current, host = timeline.current;
    if (!drag || !host || drag.axis !== "layer")
      return;
    const delta = drag.latestY - drag.y + host.scrollTop - drag.scroll;
    const layers = dragLayer(drag.order, drag.id, delta);
    const state = useCapture.getState();
    if (layers.join() !== state.layers.join())
      state.patch({ layers });
    setActive({ id: drag.id, top: Math.max(24, drag.top + delta) });
  };
  const scroll = () => {
    const drag = gesture.current, host = timeline.current;
    if (!drag || !host || drag.axis !== "layer")
      return;
    const box = host.getBoundingClientRect();
    const edge = 28;
    const speed = drag.latestY < box.top + edge ? -6 : drag.latestY > box.bottom - edge ? 6 : 0;
    if (speed) {
      host.scrollTop += speed;
      position();
    }
    frame.current = requestAnimationFrame(scroll);
  };
  const begin = (id: LayerId, event: PointerEvent, label = false) => {
    cancelAnimationFrame(frame.current);
    const order = layerOrder(useCapture.getState());
    gesture.current = { id, order, x: event.clientX, y: event.clientY, latestY: event.clientY, scroll: timeline.current?.scrollTop ?? 0, top: timelineRows(order).find(row => row.id === id)!.top, axis: "pending", label };
  };
  const move = (event: PointerEvent): Axis => {
    const drag = gesture.current;
    if (!drag)
      return "time";
    drag.latestY = event.clientY;
    if (drag.axis === "pending") {
      const dx = Math.abs(event.clientX - drag.x), dy = Math.abs(event.clientY - drag.y);
      if (Math.max(dx, dy) < 6)
        return "pending";
      drag.axis = drag.label || dy > dx ? "layer" : "time";
      if (drag.axis === "layer")
        frame.current = requestAnimationFrame(scroll);
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
    if (drag?.axis !== "layer")
      return false;
    const state = useCapture.getState(), final = state.layers;
    // Live preview uses patches. Commit exactly one undo step on a completed drop.
    state.patch({ layers: drag.order });
    if (!cancelled && final.join() !== drag.order.join())
      state.edit({ layers: final });
    return true;
  };
  return { active, begin, move, end };
}
