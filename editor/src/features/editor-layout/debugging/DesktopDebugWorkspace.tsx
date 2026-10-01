import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DebugDock } from "../../try-debugger/DebugDock";
import { setDebugOpen, useDebugUi } from "../../try-debugger/uiStore";
import { usePanelResize } from "../usePanelResize";
import { DebugResizeHandle } from "./DebugResizeHandle";
import { desktopDebugPanelGeometry } from "./debugPanelGeometry";
import { editDebugComponent } from "./debugCommands";
import { locateDebugComponent } from "./debugLocate";
import styles from "./DebugWorkspace.module.css";

/** Preserves the mounted timeline (zoom/scroll) while its diagnostic sibling is open. */
export function DesktopDebugWorkspace({ children }: { children: ReactNode }) {
  const open = useDebugUi(state => state.open);
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ bodyHeight: 0, viewportHeight: 0 });
  useLayoutEffect(() => {
    const body = container.current?.parentElement?.parentElement;
    if (!body) return;
    const measure = () => setSize({ bodyHeight: body.clientHeight - 16, viewportHeight: window.innerHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, []);
  const geometry = desktopDebugPanelGeometry(size.bodyHeight, size.viewportHeight);
  const resize = usePanelResize(geometry);
  useLayoutEffect(() => {
    const body = container.current?.parentElement?.parentElement;
    if (!body) return;
    if (open && size.bodyHeight > 0) body.style.setProperty("--desktop-timeline", `${resize.height}px`);
    else body.style.removeProperty("--desktop-timeline");
    return () => { body.style.removeProperty("--desktop-timeline"); };
  }, [open, resize.height, size.bodyHeight]);
  return <div ref={container} style={{ height: "100%", minHeight: 0 }}>
    <div className={styles.timeline} data-hidden={open} aria-hidden={open} {...(open ? { inert: "" } : {})}>{children}</div>
    {open && <section className={styles.desktopPanel} aria-label="Try debugger" data-debug-workspace="desktop"
      style={{ "--desktop-debug-height": `${resize.height}px` } as CSSProperties}>
      <DebugResizeHandle resize={resize} maximum={geometry.maximum} normal={geometry.initial} expanded={geometry.maximum} />
      <DebugDock onClose={() => setDebugOpen(false)} onTimeline={() => setDebugOpen(false)}
        onEditComponent={editDebugComponent} onLocate={locateDebugComponent} />
    </section>}
  </div>;
}
