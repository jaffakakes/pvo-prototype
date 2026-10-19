import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import {
  AppearanceSettings,
  AdvancedEditingSetting,
} from "./EditorPreferencesSettings";
import styles from "./ProjectSettingsMenu.module.css";

export function ProjectSettingsMenu() {
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocus = useRef(false);
  const id = useId();
  const busy = useCapture(
    (state) => state.importing || state.recording || state.ex === "running",
  );
  const close = () => setPosition(null);

  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setPosition(null);
    };
    const resized = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resized);
    };
  }, [position]);

  useEffect(() => {
    if (confirmDelete) keep.current?.focus();
    else if (restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      remove.current?.focus();
    }
  }, [confirmDelete]);

  const cancelDelete = () => {
    restoreDeleteFocus.current = true;
    setConfirmDelete(false);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label="Project settings"
        title="Project settings"
        aria-haspopup="dialog"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => {
          if (position) {
            close();
            return;
          }
          const header = trigger
            .current!.closest("header")!
            .getBoundingClientRect();
          const title = trigger.current!.parentElement!.getBoundingClientRect();
          setConfirmDelete(false);
          useCapture
            .getState()
            .patch({ playing: false, sheet: null, orb: false });
          setPosition({
            top: header.bottom + 4,
            left: Math.max(8, Math.min(title.left, innerWidth - 344)),
          });
        }}
      >
        <Icon name="down" size={16} />
      </button>
      {position &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label="Project settings"
            className={styles.panel}
            style={{
              ...position,
              maxHeight: `calc(100dvh - ${position.top + 8}px)`,
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== trigger.current
              )
                close();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                if (confirmDelete) cancelDelete();
                else {
                  close();
                  trigger.current?.focus();
                }
              }
            }}
          >
            <div className={styles.settings}>
              <AppearanceSettings iconOnly />
              <AdvancedEditingSetting compact />
            </div>
            <div className={styles.footer}>
              {confirmDelete ? (
                <>
                  <p>
                    Delete this project from this browser? This can’t be undone.
                  </p>
                  <div className={styles.confirmActions}>
                    <button ref={keep} type="button" onClick={cancelDelete}>
                      Keep project
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => useCapture.getState().reset()}
                    >
                      Delete project
                    </button>
                  </div>
                </>
              ) : (
                <button
                  ref={remove}
                  type="button"
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="delete" size={18} />
                  Delete Project
                </button>
              )}
            </div>
          </div>,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}
