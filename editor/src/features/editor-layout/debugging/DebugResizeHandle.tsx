import { useRef, type PointerEvent } from "react";
import type { usePanelResize } from "../usePanelResize";
import styles from "./DebugWorkspace.module.css";

type Props = {
  resize: ReturnType<typeof usePanelResize>;
  maximum: number;
  normal: number;
  expanded: number;
  mobile?: boolean;
};

export function DebugResizeHandle({ resize, maximum, normal, expanded, mobile = false }: Props) {
  const origin = useRef<number | null>(null);
  const moved = useRef(false);
  const toggle = () => resize.setHeight(resize.height > normal + 20 ? normal : expanded);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const tap = origin.current !== null && !moved.current;
    resize.handleProps.onPointerUp(event);
    origin.current = null;
    if (tap && mobile) toggle();
  };
  return <div className={styles.handle} data-mobile={mobile} role="separator" tabIndex={0}
    aria-label="Resize debugger" aria-orientation="horizontal" aria-valuemin={0}
    aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(resize.height)}
    title={mobile ? "Drag to resize; tap to expand or restore" : "Drag to resize debugger"}
    {...resize.handleProps}
    onPointerDown={event => {
      if (event.isPrimary && event.button === 0) { origin.current = event.clientY; moved.current = false; }
      resize.handleProps.onPointerDown(event);
    }}
    onPointerMove={event => {
      if (origin.current !== null && Math.abs(event.clientY - origin.current) > 4) moved.current = true;
      resize.handleProps.onPointerMove(event);
    }}
    onPointerUp={finish}
    onPointerCancel={event => { origin.current = null; resize.handleProps.onPointerCancel(event); }}
    onKeyDown={event => {
      if (mobile && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggle(); }
      else resize.handleProps.onKeyDown(event);
    }}><span /></div>;
}
