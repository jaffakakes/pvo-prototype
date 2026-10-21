import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Scene, Ratio } from "../../domain/project/model";
import { useEditorTransition } from "../../ui/motion/EditorMotion";
import { Icon } from "../../ui/Icon";
import { ExportPreview } from "../export/ExportPreview";
import { FrameFilmstrip } from "./FrameFilmstrip";
import styles from "./FramePicker.module.css";

export function FramePicker({
  scene,
  ratio,
  time,
  maximum,
  label,
  sliderLabel,
  closeLabel,
  onTime,
  onSave,
  onClose,
}: {
  scene: Scene;
  ratio: Ratio;
  time: number;
  maximum: number;
  label: string;
  sliderLabel: string;
  closeLabel: string;
  onTime(time: number): void;
  onSave(): void;
  onClose(): void;
}) {
  const transition = useEditorTransition();
  const close = () => transition("frame", onClose, "close");
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
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
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
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
          aria-label={closeLabel}
          onClick={close}
        >
          <Icon name="close" size={24} />
        </button>
        <button
          type="button"
          className={styles.save}
          onClick={() => transition("frame", onSave, "close")}
        >
          Save
        </button>
      </header>
      <div className={styles.preview}>
        <ExportPreview
          scene={scene}
          ratio={ratio}
          mode="picker"
          pickerTime={time}
          onPickerTime={onTime}
          artifact={null}
          artifactUrl={null}
          coverOnly
        />
      </div>
      <footer className={styles.footer}>
        <FrameFilmstrip
          scene={scene}
          time={time}
          maximum={maximum}
          onTime={onTime}
          label={sliderLabel}
          showHint
        />
      </footer>
    </dialog>,
    document.querySelector(".app") ?? document.body,
  );
}
