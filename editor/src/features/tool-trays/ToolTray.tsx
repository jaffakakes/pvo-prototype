import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./ToolTray.module.css";

/** Live tools share the editor's existing colours and controls, without a modal. */
export function ToolTray({
  name,
  readout,
  action,
  caption = true,
  children,
}: {
  name: string;
  readout?: ReactNode;
  action?: ReactNode;
  caption?: boolean;
  children: ReactNode;
}) {
  const tray = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    // Opening a tray removes the toolbar button that previously owned focus.
    tray.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={tray}
      tabIndex={-1}
      className={styles.tray}
      aria-label={name}
      data-tool-tray={name.toLowerCase()}
    >
      <div className={styles.controls}>{children}</div>
      {caption && (
        <footer className={styles.caption}>
          <span className={styles.readout}>{readout}</span>
          <strong>{name}</strong>
          <div className={styles.action}>{action}</div>
        </footer>
      )}
    </section>
  );
}
