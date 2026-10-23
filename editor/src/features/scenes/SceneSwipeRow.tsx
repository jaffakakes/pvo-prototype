import type { ReactNode } from "react";
import { useSceneSwipe } from "./useSceneSwipe";
import styles from "./ScenesPanel.module.css";

type Props = {
  scene: { id: string; name: string };
  active: boolean;
  revealed: boolean;
  onReveal(open: boolean): void;
  onOpen(): void;
  onAction(action: "rename" | "delete"): void;
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
};

export function SceneSwipeRow({
  scene,
  active,
  revealed,
  onReveal,
  onOpen,
  onAction,
  label,
  children,
  className,
  disabled = false,
}: Props) {
  const swipe = useSceneSwipe(revealed, onReveal);
  const editable = scene.id !== "main" && !disabled;
  return (
    <div className={styles.swipeViewport} data-scene-actions={revealed}>
      {editable && (
        <div
          className={styles.sceneActions}
          {...(!revealed ? { inert: "" } : {})}
          aria-hidden={!revealed}
        >
          <button
            type="button"
            onClick={() => onAction("rename")}
            aria-label={`Rename ${scene.name}`}
          >
            Rename
          </button>
          <button
            type="button"
            className={styles.deleteAction}
            onClick={() => onAction("delete")}
            aria-label={`Delete ${scene.name}`}
          >
            Delete
          </button>
        </div>
      )}
      <button
        type="button"
        className={`${styles.swipeButton} ${className ?? styles.node}`}
        disabled={disabled}
        data-scene-id={scene.id}
        data-dragging={swipe.dragging}
        style={{ transform: `translateX(${editable ? swipe.offset : 0}px)` }}
        aria-current={active ? "true" : undefined}
        aria-label={label}
        aria-description={
          editable
            ? "Slide left for Rename and Delete. Keyboard: Left arrow reveals actions, F2 renames, Delete removes."
            : undefined
        }
        {...(editable ? swipe.handlers : {})}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!editable) return;
          if (event.key === "Escape") swipe.cancel();
          if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            (event.key === "Escape" && revealed)
          ) {
            event.preventDefault();
            event.stopPropagation();
            onReveal(event.key === "ArrowLeft");
          } else if (event.key === "F2" || event.key === "Delete") {
            event.preventDefault();
            event.stopPropagation();
            onAction(event.key === "F2" ? "rename" : "delete");
          }
        }}
        onClick={() => {
          if (swipe.consumeClick()) return;
          if (revealed) onReveal(false);
          else onOpen();
        }}
      >
        {children}
      </button>
    </div>
  );
}
