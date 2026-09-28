import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type Options = { maximum: number; initial: number; minimum?: number; dismissBelow?: number; dismiss?(): void };
type PreferredSize = number | "full" | null;
type Drag = { pointerId: number; y: number; height: number; preferred: PreferredSize; handle: HTMLDivElement };
const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, maximum));

/** Local presentation state; resizing never creates project history. */
export function usePanelResize({ maximum, initial, minimum: requestedMinimum = 180, dismissBelow = 96, dismiss }: Options) {
  const [preferred, setPreferred] = useState<PreferredSize>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const options = useRef({ maximum, initial, dismiss });
  options.current = { maximum, initial, dismiss };
  const minimum = Math.min(requestedMinimum, maximum);
  const lowerBound = dismiss ? 0 : minimum;
  const height = Math.max(lowerBound, clamp(preferred === "full" ? maximum : preferred ?? initial, maximum));
  const heightRef = useRef(height);
  heightRef.current = height;

  const close = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (current?.handle.hasPointerCapture(current.pointerId)) {
      current.handle.releasePointerCapture(current.pointerId);
    }
    setPreferred(null);
    options.current.dismiss?.();
  }, []);

  const setExpanded = useCallback((expanded: boolean) => {
    setPreferred(expanded ? "full" : null);
  }, []);

  const setHeight = useCallback((value: number) => setPreferred(value), []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, y: event.clientY, height: heightRef.current, preferred, handle: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = Math.max(lowerBound, clamp(current.height + current.y - event.clientY, maximum));
    heightRef.current = next;
    setPreferred(next);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) setPreferred(current.preferred);
    else if (dismiss && heightRef.current < Math.min(dismissBelow, maximum * 0.45)) close();
    else if (heightRef.current >= maximum - 24) setPreferred("full");
    else setPreferred(Math.max(minimum, heightRef.current));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" || (event.key === "End" && dismiss)) close();
    else if (event.key === "End") setPreferred(minimum);
    else if (event.key === "Home") setExpanded(true);
    else setPreferred(Math.max(minimum, clamp(height + (event.key === "ArrowUp" ? 40 : -40), maximum)));
  };

  return {
    height, dragging, customized: preferred !== null,
    expanded: maximum > 0 && height >= maximum - 2, setExpanded, setHeight, dismiss: close,
    handleProps: {
      onPointerDown, onPointerMove, onPointerUp: (event: PointerEvent<HTMLDivElement>) => finishDrag(event),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finishDrag(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finishDrag(event, true), onKeyDown,
    },
  };
}
