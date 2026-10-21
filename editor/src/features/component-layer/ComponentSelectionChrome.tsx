import { useRef } from "react";
import {
  componentGestureScale,
  scaleComponentUniformly,
} from "../../domain/components/scale";
import { componentTypeName } from "../../domain/components/presentation";
import type { PvoComponent } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { useLayerGesture } from "./useLayerGesture";
import styles from "./ComponentSelection.module.css";

export function ComponentSelectionChrome({
  component,
}: {
  component: PvoComponent;
}) {
  const transforming = useCapture(
    (state) => state.sheet === "componentTransform",
  );
  const gesture = useLayerGesture(component.id);
  const start = useRef<{
    x: number;
    y: number;
    distance: number;
    component: PvoComponent;
  } | null>(null);
  return (
    <div className={styles.outline} data-component-selection>
      <span className={styles.tag}>{componentTypeName(component)}</span>
      {transforming &&
        ["tl", "tr", "bl", "br"].map((corner) => (
          <button
            type="button"
            key={corner}
            className={styles.handle}
            data-corner={corner}
            data-component-resize
            aria-label={`Resize ${componentTypeName(component).toLowerCase()} ${corner}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const rect =
                event.currentTarget.parentElement!.getBoundingClientRect();
              const x = rect.x + rect.width / 2,
                y = rect.y + rect.height / 2;
              start.current = {
                x,
                y,
                distance: Math.max(
                  1,
                  Math.hypot(event.clientX - x, event.clientY - y),
                ),
                component,
              };
              useCapture.getState().patch({ playing: false });
              gesture.begin();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const first = start.current;
              if (
                !first ||
                !event.currentTarget.hasPointerCapture(event.pointerId)
              )
                return;
              const ratio =
                Math.hypot(event.clientX - first.x, event.clientY - first.y) /
                first.distance;
              gesture.update(
                scaleComponentUniformly(
                  first.component,
                  Math.max(
                    0.5,
                    Math.min(2, componentGestureScale(first.component) * ratio),
                  ),
                ),
              );
            }}
            onPointerUp={(event) => {
              start.current = null;
              gesture.commit();
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              start.current = null;
              gesture.cancel();
            }}
            onLostPointerCapture={() => {
              start.current = null;
              gesture.cancel();
            }}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              const sign = ["ArrowLeft", "ArrowDown"].includes(event.key)
                ? -1
                : 1;
              gesture.update(
                scaleComponentUniformly(
                  component,
                  Math.max(
                    0.5,
                    Math.min(
                      2,
                      componentGestureScale(component) +
                        sign * (event.shiftKey ? 0.1 : 0.01),
                    ),
                  ),
                ),
              );
            }}
            onKeyUp={gesture.commit}
            onBlur={gesture.commit}
          />
        ))}
    </div>
  );
}

export function ComponentGuides() {
  const selected = useCapture((state) =>
    state.sheet === "componentTransform" && !state.tryMode
      ? state.components.find((item) => item.id === state.selComp)
      : undefined,
  );
  if (!selected) return null;
  return (
    <div className={styles.guides} aria-hidden="true">
      {selected.x === 50 && <span className={styles.vertical} />}
      {selected.y === 50 && <span className={styles.horizontal} />}
    </div>
  );
}
