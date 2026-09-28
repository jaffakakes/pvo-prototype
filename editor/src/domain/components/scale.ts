import { componentScale, componentSize, componentPixelDimension, MIN_COMPONENT_SCALE, MAX_COMPONENT_SCALE, MAX_COMPONENT_PIXELS, type ComponentGeometry } from "../../../../packages/pvo-component-runtime/index.js";
import { clamp } from "../project/numbers";

export { componentScale, componentSize, MIN_COMPONENT_SCALE, MAX_COMPONENT_SCALE };

/** The geometric mean leaves room to pinch either axis to its allowed limit. */
export function componentGestureScale(component: ComponentGeometry): number {
  if (componentPixelDimension(component.width) !== undefined || componentPixelDimension(component.height) !== undefined) {
    return componentScale(component.scale);
  }
  const size = componentSize(component);
  return Math.sqrt(size.width * size.height);
}

/** A pinch preserves both axis proportions, stopping when either reaches a limit. */
export function scaleComponentUniformly(component: ComponentGeometry, requested: number): ComponentGeometry & { scale: number } {
  const original = componentGestureScale(component);
  const size = componentSize(component);
  let min = Math.max(MIN_COMPONENT_SCALE, original * MIN_COMPONENT_SCALE / Math.min(size.width, size.height));
  let max = Math.min(MAX_COMPONENT_SCALE, original * MAX_COMPONENT_SCALE / Math.max(size.width, size.height));
  for (const value of [component.width, component.height]) {
    const pixels = componentPixelDimension(value);
    if (pixels !== undefined) {
      min = Math.max(min, 1 / pixels);
      max = Math.min(max, MAX_COMPONENT_PIXELS / pixels);
    }
  }
  const scale = clamp(componentScale(requested), min, max);
  const factor = scale / original;
  return {
    scale,
    ...(component.scaleX === undefined && component.scaleY === undefined ? {} : {
      scaleX: componentScale(size.width * factor),
      scaleY: componentScale(size.height * factor),
    }),
  };
}
