import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./TrackingPointPicker.module.css";

type Point = { x: number; y: number };

/** A frozen tool frame sits over the canvas; pointer events never reach editing gestures. */
export function TrackingPointPicker({ frame, onPick, onCancel }: {
  frame: { dataUrl: string; width: number; height: number };
  onPick(point: Point): void;
  onCancel(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [point, setPoint] = useState<Point>({ x: .5, y: .5 });
  useLayoutEffect(() => {
    const preview = document.querySelector(".pvBox");
    if (!preview) return;
    const measure = () => setRect(preview.getBoundingClientRect());
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [!!rect]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onCancel]);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const position = (clientX: number, clientY: number): Point => ({
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  });
  return createPortal(<div className={styles.picker} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
    <button type="button" ref={button} className={styles.canvasPick} aria-label="Choose the object in the video"
      data-tracking-point-picker onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onPointerMove={event => setPoint(position(event.clientX, event.clientY))}
      onClick={event => { event.stopPropagation(); onPick(event.detail === 0 ? point : position(event.clientX, event.clientY)); }}
      onKeyDown={event => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault(); event.stopPropagation();
        setPoint(previous => ({ x: Math.max(0, Math.min(1, previous.x + (event.key === "ArrowLeft" ? -.02 : event.key === "ArrowRight" ? .02 : 0))),
          y: Math.max(0, Math.min(1, previous.y + (event.key === "ArrowUp" ? -.02 : event.key === "ArrowDown" ? .02 : 0))) }));
      }}>
      <img src={frame.dataUrl} alt="First frame of the tracking range" draggable={false} />
      <span className={styles.crosshair} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} aria-hidden="true">+</span>
      <span className={styles.pickHint}>Which one? Tap it on the video</span>
    </button>
    <button type="button" className={styles.cancelPick} onClick={onCancel}>Cancel picking</button>
  </div>, document.body);
}
