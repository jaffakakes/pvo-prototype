import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Scene, Ratio } from "../../domain/project/model";
import { exportCoverAt } from "../../domain/project/cover";
import { sceneDuration } from "../../domain/scenes/duration";
import { saveProjectCover } from "../../state/editing/coverCommands";
import { Icon } from "../../ui/Icon";
import { ExportPreview } from "../export/ExportPreview";
import { CoverFilmstrip } from "./CoverFilmstrip";
import styles from "./CoverPicker.module.css";

export function CoverPicker({
  scene,
  ratio,
  initialTime,
  onClose,
}: {
  scene: Scene;
  ratio: Ratio;
  initialTime: number;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [time, setTime] = useState(initialTime);
  const maximum = Math.max(0, sceneDuration(scene) - 1 / 30);
  const shownTime = exportCoverAt({ scenes: [scene], coverAt: time });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Choose cover"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header className={styles.header}>
        <button
          type="button"
          className={styles.close}
          aria-label="Close cover picker"
          onClick={onClose}
        >
          <Icon name="close" size={24} />
        </button>
        <button
          type="button"
          className={styles.save}
          onClick={() => {
            saveProjectCover(shownTime);
            onClose();
          }}
        >
          Save
        </button>
      </header>
      <div className={styles.preview}>
        <ExportPreview
          scene={scene}
          ratio={ratio}
          mode="picker"
          pickerTime={shownTime}
          onPickerTime={setTime}
          artifact={null}
          artifactUrl={null}
          coverOnly
        />
      </div>
      <footer className={styles.footer}>
        <CoverFilmstrip
          scene={scene}
          time={shownTime}
          maximum={maximum}
          onTime={setTime}
        />
        <p>Slide to select</p>
      </footer>
    </dialog>,
    document.querySelector(".app") ?? document.body,
  );
}
