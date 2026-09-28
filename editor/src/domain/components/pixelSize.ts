import { componentPixelDimension, componentPixelSize, type ComponentDimensions } from "../../../../packages/pvo-component-runtime/index.js";
import type { PvoComponent } from "../project/model";

/** Bake current geometry into pixels so editing one axis retains the other exactly. */
export function resizeComponentPixels(component: PvoComponent, natural: ComponentDimensions, axis: "width" | "height", pixels: number): Partial<PvoComponent> {
  const value = componentPixelDimension(pixels);
  if (value === undefined) return {};
  const size = componentPixelSize(component, natural);
  return { ...size, [axis]: value, scale: 1, scaleX: undefined, scaleY: undefined };
}
