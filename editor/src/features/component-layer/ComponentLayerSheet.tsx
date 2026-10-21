import {
  componentOpacity,
  componentRotation,
} from "../../../../packages/pvo-component-runtime/index.js";
import {
  componentGestureScale,
  scaleComponentUniformly,
} from "../../domain/components/scale";
import { useCapture } from "../../state/captureStore";
import { componentLayerTool } from "../../state/components/componentLayerCommands";
import { Shell } from "../../ui/SheetShell";
import { LayerRange } from "./LayerRange";
import styles from "./ComponentLayer.module.css";

export function ComponentLayerSheet() {
  const component = useCapture((state) =>
    state.components.find((item) => item.id === state.selComp),
  );
  const tool = useCapture((state) => componentLayerTool(state.sheet));
  if (!component || !tool || tool === "timing") return null;
  const update = useCapture.getState().updateComponent;
  const opacity = Math.round(componentOpacity(component.opacity) * 100);
  const rotation = componentRotation(component.rotation);
  const scale = Math.round(componentGestureScale(component) * 100);
  const title = {
    opacity: "Opacity",
    transform: "Transform",
  }[tool];
  const reset =
    scale !== 100 ||
    rotation !== 0 ||
    component.x !== 50 ||
    component.y !== (component.type === "tooltip" ? 28 : 60);
  return (
    <Shell
      key={`${component.id}:${tool}`}
      title={`${title} controls`}
      actions={
        tool === "transform" && reset ? (
          <button
            type="button"
            className={styles.reset}
            onClick={() =>
              update(component.id, {
                x: 50,
                y: component.type === "tooltip" ? 28 : 60,
                ...scaleComponentUniformly(component, 1),
                rotation: 0,
              })
            }
          >
            Reset
          </button>
        ) : undefined
      }
    >
      <div className={styles.control} data-component-control={tool}>
        {tool === "opacity" && (
          <div className={styles.opacity}>
            <output>{opacity}%</output>
            <LayerRange
              component={component}
              label="Opacity"
              value={opacity}
              min={0}
              max={100}
              unit="%"
              change={(value) => ({ opacity: value / 100 })}
            />
          </div>
        )}
        {tool === "transform" && (
          <>
            <label className={styles.transformRow}>
              <strong>Size</strong>
              <LayerRange
                component={component}
                label="Size"
                value={scale}
                min={50}
                max={200}
                unit="%"
                change={(value) =>
                  scaleComponentUniformly(component, value / 100)
                }
              />
              <output>{scale}%</output>
            </label>
            <label className={styles.transformRow}>
              <strong>Rotation</strong>
              <LayerRange
                component={component}
                label="Rotation"
                value={rotation}
                min={-45}
                max={45}
                unit="°"
                change={(value) => ({ rotation: value })}
              />
              <output>{Math.round(rotation)}°</output>
            </label>
            <p className={styles.hint}>
              Drag to position. Drag a corner to resize.
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
