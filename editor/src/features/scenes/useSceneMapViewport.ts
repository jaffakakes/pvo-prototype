import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

export function useSceneMapViewport(currentId: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 390, height: 170 });
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const distance = useRef(0);
  const dragged = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    setPan({ x: 0, y: 0 });
    setFit(false);
    setZoom(1);
  }, [currentId]);
  const changeZoom = (value: number) => {
    setFit(false);
    setZoom(Math.max(0.5, Math.min(1.5, value)));
    setPan({ x: 0, y: 0 });
  };
  const handlers = {
    onClickCapture: (event: import("react").MouseEvent) => {
      if (dragged.current) {
        event.preventDefault();
        event.stopPropagation();
        dragged.current = false;
      }
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('[aria-label="Map zoom"]'))
        return;
      if (!points.current.size) {
        dragged.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
      }
      points.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      distance.current = 0;
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const previous = points.current.get(event.pointerId);
      if (!previous) return;
      if (
        points.current.size < 2 &&
        !dragged.current &&
        Math.hypot(
          event.clientX - origin.current.x,
          event.clientY - origin.current.y,
        ) < 5
      )
        return;
      dragged.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      points.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()];
        const next = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance.current) {
          setFit(false);
          setZoom((value) =>
            Math.max(0.5, Math.min(1.5, (value * next) / distance.current)),
          );
        }
        distance.current = next;
      } else
        setPan((value) => ({
          x: value.x + event.clientX - previous.x,
          y: value.y + event.clientY - previous.y,
        }));
    },
    onPointerUp: (event: PointerEvent) => {
      points.current.delete(event.pointerId);
      distance.current = 0;
    },
    onPointerCancel: (event: PointerEvent) => {
      points.current.delete(event.pointerId);
      distance.current = 0;
    },
    onLostPointerCapture: (event: PointerEvent) => {
      points.current.delete(event.pointerId);
      distance.current = 0;
    },
  };
  return {
    ref,
    size,
    zoom,
    fit,
    pan,
    handlers,
    changeZoom,
    fitAll: () => {
      setFit(true);
      setPan({ x: 0, y: 0 });
    },
  };
}
