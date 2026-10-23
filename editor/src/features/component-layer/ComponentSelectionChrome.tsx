import { componentTypeName } from "../../domain/components/presentation";
import type { PvoComponent } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import styles from "./ComponentSelection.module.css";

export function ComponentSelectionChrome({
  component,
}: {
  component: PvoComponent;
}) {
  const transforming = useCapture(
    (state) => state.sheet === "crop" || state.sheet === "keyframes",
  );
  return (
    <div
      className={styles.outline}
      data-component-selection
      role={transforming ? "group" : undefined}
      tabIndex={transforming ? 0 : undefined}
      aria-label={
        transforming
          ? `Transform ${componentTypeName(component).toLowerCase()}`
          : undefined
      }
      aria-description={
        transforming
          ? "Drag to move. Pinch to scale and twist to rotate. Drag a corner to scale or Alt-drag to rotate. Use arrow keys to move, plus or minus to scale, and bracket keys to rotate."
          : undefined
      }
    >
      <span className={styles.tag}>{componentTypeName(component)}</span>
      {transforming &&
        ["tl", "tr", "bl", "br"].map((corner) => (
          <button
            type="button"
            key={corner}
            className={styles.handle}
            data-corner={corner}
            data-transform-handle
            aria-label={`Resize ${componentTypeName(component).toLowerCase()} ${corner}`}
          />
        ))}
    </div>
  );
}
