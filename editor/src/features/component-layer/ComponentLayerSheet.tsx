import { componentOpacity } from "../../../../packages/pvo-component-runtime/index.js";
import { useCapture } from "../../state/captureStore";
import { Shell } from "../../ui/SheetShell";
import { LayerRange } from "./LayerRange";
import styles from "./ComponentLayer.module.css";

export function ComponentLayerSheet() {
  const component = useCapture((state) =>
    state.components.find((item) => item.id === state.selComp),
  );
  if (!component) return null;
  const opacity = Math.round(componentOpacity(component.opacity) * 100);
  return (
    <Shell key={component.id} title="Opacity controls">
      <div className={styles.control} data-component-control="opacity">
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
      </div>
    </Shell>
  );
}
