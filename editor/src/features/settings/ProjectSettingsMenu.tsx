import { useEffect, useId, useRef, useState } from "react";
import { useHeaderPopover } from "../../ui/useHeaderPopover";
import { createPortal } from "react-dom";
import { useCapture } from "../../state/captureStore";
import { Icon } from "../../ui/Icon";
import {
  AppearanceSettings,
  AdvancedEditingSetting,
  ReduceMotionSetting,
} from "./EditorPreferencesSettings";
import styles from "./ProjectSettingsMenu.module.css";

export function ProjectSettingsMenu() {
  const { trigger, panel, position, open, close } = useHeaderPopover(336);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocus = useRef(false);
  const id = useId();
  const busy = useCapture(
    (state) => state.importing || state.recording || state.ex === "running",
  );
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
          setConfirmDelete(false);
          useCapture
            .getState()
            .patch({ playing: false, sheet: null, orb: false });
          open();
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
              <ReduceMotionSetting compact />
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
