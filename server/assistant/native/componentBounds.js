import { componentPixelSize } from "../../../packages/pvo-component-runtime/index.js";

const geometryTracks = ["x", "y", "scaleX", "scaleY", "rotation"];
const pixels = value => Math.round(value * 1_000_000) / 1_000_000 || 0;

/** Static authored rectangles only: no intrinsic measurement or animated/rotated fit claim. */
export function authoredComponentBounds(component, canvas) {
  if (![component.width, component.height, canvas.width, canvas.height].every(value => Number.isFinite(value) && value > 0)
    || ![component.x, component.y].every(Number.isFinite)
    || geometryTracks.some(property => component.animation?.tracks?.[property]?.length)) return null;
  // Both axes are explicit, so the runtime ignores natural dimensions and uses
  // each authored dimension times uniform scale, regardless of axis overrides.
  const size = componentPixelSize(component, { width: 0, height: 0 });
  const centerX = canvas.width * component.x / 100;
  const centerY = canvas.height * component.y / 100;
  const margins = {
    left: pixels(centerX - size.width / 2),
    right: pixels(canvas.width - centerX - size.width / 2),
    top: pixels(centerY - size.height / 2),
    bottom: pixels(canvas.height - centerY - size.height / 2),
  };
  const outsideEdges = Object.keys(margins).filter(edge => margins[edge] < 0);
  return { units: "canvas_pixels", width: pixels(size.width), height: pixels(size.height),
    margins, outsideEdges, fitsCanvas: outsideEdges.length === 0 };
}
