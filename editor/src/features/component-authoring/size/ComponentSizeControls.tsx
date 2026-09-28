import { useId, useRef, useState } from "react";
import { componentPixelSize, componentSize, MAX_COMPONENT_PIXELS } from "../../../../../packages/pvo-component-runtime/index.js";
import { resizeComponentPixels } from "../../../domain/components/pixelSize";
import { projectCanvasSize } from "../../../domain/project/ratio";
import type { PvoComponent } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { useComponentMeasurements } from "../../../state/components/componentMeasurements";
import styles from "./ComponentSizeControls.module.css";

function SizeField({ label, value, descriptionId, onCommit }: {
  label: string;
  value: number | null;
  descriptionId: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return <label className={styles.field}>
    <span>{label} <span className={styles.unit}>(px)</span></span>
    <input
      type="number"
      aria-label={`${label} (px)`}
      aria-describedby={descriptionId}
      min="1"
      max={MAX_COMPONENT_PIXELS}
      step="1"
      disabled={value === null}
      value={draft ?? (value === null ? "" : Math.round(value))}
      onFocus={() => { cancelled.current = false; }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (!cancelled.current && draft !== null && draft.trim() && Number.isFinite(Number(draft))) {
          onCommit(Number(draft));
        }
        setDraft(null);
      }}
      onKeyDown={event => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = event.key === "Escape";
        event.currentTarget.blur();
      }}
    />
  </label>;
}

/** Host geometry stays editable for visual and code-owned components alike. */
export function ComponentSizeControls({ component }: { component: PvoComponent }) {
  const descriptionId = useId();
  const natural = useComponentMeasurements(state => state.sizes[component.id]);
  const ratio = useCapture(state => state.ratio);
  const canvas = projectCanvasSize(ratio);
  const size = natural ? componentPixelSize(component, natural) : null;
  const scale = componentSize(component);
  const update = useCapture(state => state.updateComponent);
  const resize = (axis: "width" | "height", pixels: number) => {
    const current = useCapture.getState().components.find(item => item.id === component.id);
    const measured = useComponentMeasurements.getState().sizes[component.id];
    if (current && measured) update(component.id, resizeComponentPixels(current, measured, axis, pixels));
  };
  return <section className={styles.size} aria-label="Component size">
    <div className={styles.heading}>
      <h3>Size</h3>
      <button type="button" disabled={component.width === undefined && component.height === undefined && scale.width === 1 && scale.height === 1}
        onClick={() => update(component.id, { width: undefined, height: undefined, scale: 1, scaleX: undefined, scaleY: undefined })}>
        Reset size
      </button>
    </div>
    <div className={styles.fields}>
      <SizeField label="Width" value={size?.width ?? null} descriptionId={descriptionId}
        onCommit={pixels => resize("width", pixels)} />
      <SizeField label="Height" value={size?.height ?? null} descriptionId={descriptionId}
        onCommit={pixels => resize("height", pixels)} />
    </div>
    <p id={descriptionId}>Pixels on the {canvas.width} × {canvas.height} canvas. Press Enter or leave the field to apply.</p>
  </section>;
}
