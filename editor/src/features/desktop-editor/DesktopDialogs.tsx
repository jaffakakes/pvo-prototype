import { useEffect, useMemo, useRef } from "react";
import { Sheets } from "../../app/Sheets";
import { useCapture } from "../../state/captureStore";
import { SheetDockContext, type SheetDockContextValue } from "../../ui/sheets/SheetDockContext";
import styles from "./DesktopDialogs.module.css";

/** Export and settings retain their existing workflows outside the inspector. */
export function DesktopDialogs() {
  const sheet = useCapture(state => state.sheet);
  return sheet === "export" || sheet === "more" || sheet === "discard"
    ? <EditorDialog key={sheet} /> : null;
}

function EditorDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useRef(() => useCapture.getState().patch({ sheet: null }));
  const context = useMemo<SheetDockContextValue>(() => ({
    expanded: false,
    setExpanded: () => undefined,
    registerDismiss(handler) {
      dismiss.current = handler;
      return () => { dismiss.current = () => useCapture.getState().patch({ sheet: null }); };
    },
  }), []);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className={styles.dialog} aria-label="Editor dialog"
    onCancel={event => { event.preventDefault(); dismiss.current(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss.current(); }}>
    <div className={styles.content}>
      <SheetDockContext.Provider value={context}><Sheets /></SheetDockContext.Provider>
    </div>
  </dialog>;
}
