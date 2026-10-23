import styles from "./CropGuides.module.css";

/** The frame follows the video; the gesture surface keeps stable canvas coordinates. */
export function CropGuides({
  scale,
  transform,
  topZ,
  compact,
}: {
  scale: number;
  transform: string;
  topZ: number;
  compact: boolean;
}) {
  return (
    <div
      className={styles.guides}
      style={{ zIndex: topZ }}
      data-crop-guides
      data-compact={compact}
      role="group"
      aria-label="Transform video"
      tabIndex={0}
      aria-description="Drag to move. Pinch to scale and twist to rotate. With a mouse, drag a corner to scale or Alt-drag to rotate. Use arrow keys to move, plus or minus to scale, and bracket keys to rotate."
    >
      <div className={styles.frame} style={{ transform }} data-crop-frame>
        <div className={styles.grid} aria-hidden="true" />
        {["top-left", "top-right", "bottom-left", "bottom-right"].map(
          (corner) => (
            <span
              key={corner}
              className={styles.corner}
              data-crop-handle={corner}
              data-transform-handle
              role={compact ? undefined : "slider"}
              tabIndex={compact ? undefined : 0}
              aria-hidden={compact || undefined}
              aria-label={`Scale video from ${corner.replace("-", " ")}`}
              aria-valuenow={Math.round(scale * 100)}
              aria-valuemin={50}
              aria-valuemax={200}
              aria-valuetext={`${Math.round(scale * 100)}%. Use arrow keys to scale.`}
            />
          ),
        )}
      </div>
    </div>
  );
}
