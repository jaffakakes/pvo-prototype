import type { CSSProperties } from "react";
import type { PvoComponent } from "../../domain/project/model";
import { useLayerGesture } from "./useLayerGesture";
import styles from "./ComponentLayer.module.css";

export function LayerRange({
  component,
  label,
  value,
  min,
  max,
  unit,
  change,
}: {
  component: PvoComponent;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  change(value: number): Partial<PvoComponent>;
}) {
  const gesture = useLayerGesture(component.id);
  return (
    <input
      type="range"
      className={styles.range}
      style={
        {
          "--range-value": `${((value - min) / (max - min)) * 100}%`,
        } as CSSProperties
      }
      min={min}
      max={max}
      step={1}
      value={value}
      aria-label={label}
      aria-valuetext={`${Math.round(value)}${unit}`}
      onPointerDown={(event) => {
        gesture.begin();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onChange={(event) =>
        gesture.update(change(Number(event.currentTarget.value)))
      }
      onPointerUp={(event) => {
        gesture.commit();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={gesture.cancel}
      onLostPointerCapture={gesture.cancel}
      onBlur={gesture.commit}
      onKeyDown={(event) => {
        if (
          ![
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(event.key)
        )
          return;
        gesture.begin();
        if (event.shiftKey && event.key.startsWith("Arrow")) {
          event.preventDefault();
          const sign = ["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1;
          gesture.update(
            change(Math.max(min, Math.min(max, value + sign * 10))),
          );
        }
      }}
      onKeyUp={gesture.commit}
    />
  );
}
