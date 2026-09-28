import { useLayoutEffect, useRef } from "react";
import { componentPixelTransform, observeComponentSize } from "../../../../packages/pvo-component-runtime/index.js";
import { projectCanvasSize } from "../../domain/project/ratio";
import type { PvoComponent } from "../../domain/project/model";
import { useCapture } from "../../state/captureStore";
import { forgetComponentMeasurement, measureComponent, useComponentMeasurements } from "../../state/components/componentMeasurements";

export function useComponentDimensions(component: PvoComponent, previewWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const ratio = useCapture(state => state.ratio);
  const natural = useComponentMeasurements(state => state.sizes[component.id]);
  const canvasWidth = projectCanvasSize(ratio).width;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || previewWidth <= 0) return;
    return observeComponentSize(element, size => {
      const unit = canvasWidth / previewWidth;
      measureComponent(component.id, { width: size.width * unit, height: size.height * unit });
    });
  }, [component.id, previewWidth, canvasWidth]);
  useLayoutEffect(() => () => forgetComponentMeasurement(component.id), [component.id]);
  return { ref, size: componentPixelTransform(component, natural) };
}
