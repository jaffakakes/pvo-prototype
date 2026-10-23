import { useEffect, useRef, useState, type PointerEvent } from "react";

export const SCENE_ACTION_WIDTH = 152;

/** Horizontal scene actions leave vertical scrolling to the browser. */
export function useSceneSwipe(
  open: boolean,
  onReveal: (open: boolean) => void,
) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    offset: number;
    dragging: boolean;
  }>();
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState<number | null>(null);
  const cancel = () => {
    gesture.current = undefined;
    setOffset(null);
  };
  useEffect(() => {
    const stop = () => {
      gesture.current = undefined;
      setOffset(null);
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);
  return {
    cancel,
    offset: offset ?? (open ? -SCENE_ACTION_WIDTH : 0),
    dragging: offset !== null,
    consumeClick() {
      const suppressed = suppressClick.current;
      suppressClick.current = false;
      return suppressed;
    },
    handlers: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          offset: open ? -SCENE_ACTION_WIDTH : 0,
          dragging: false,
        };
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (!current.dragging) {
          if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
            cancel();
            return;
          }
          if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
          current.dragging = true;
          suppressClick.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        setOffset(
          Math.max(-SCENE_ACTION_WIDTH, Math.min(0, current.offset + dx)),
        );
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        if (current.dragging) {
          const end = current.offset + event.clientX - current.x;
          onReveal(end < -SCENE_ACTION_WIDTH / 3);
        }
        cancel();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: cancel,
      onBlur: cancel,
      onLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
        // Touch starts on the row's children; moving capture to the row emits
        // a bubbling loss for that child before the row owns the gesture.
        if (
          event.target === event.currentTarget &&
          !event.currentTarget.hasPointerCapture(event.pointerId)
        )
          cancel();
      },
    },
  };
}
