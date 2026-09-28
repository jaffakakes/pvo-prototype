/** Scale factors are relative to the component's original rendered dimensions. */
export const MIN_COMPONENT_SCALE = .25;
export const MAX_COMPONENT_SCALE = 3;
export const MAX_COMPONENT_PIXELS = 16384;

/** Authoring pixels use a fixed 1080px short edge, independent of preview zoom. */
export function canvasPixelSize(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    return { width: 1080, height: 1920 };
  }
  const unit = 1080 / Math.min(width, height);
  return { width: Math.round(width * unit), height: Math.round(height * unit) };
}

export function componentPixelDimension(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_COMPONENT_PIXELS, value)) : undefined;
}

export function componentScale(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(MIN_COMPONENT_SCALE, Math.min(MAX_COMPONENT_SCALE, value)) : 1;
}

/** Older components use a uniform scale; each explicit axis overrides it. */
export function componentSize(component = {}) {
  const scale = componentScale(component?.scale);
  return {
    width: component?.scaleX === undefined ? scale : componentScale(component.scaleX),
    height: component?.scaleY === undefined ? scale : componentScale(component.scaleY),
  };
}

/** Explicit pixel dimensions override legacy scale factors on their own axes. */
export function componentPixelSize(component, natural) {
  const size = componentSize(component);
  const scale = componentScale(component?.scale);
  const width = componentPixelDimension(component?.width);
  const height = componentPixelDimension(component?.height);
  return {
    width: width === undefined ? natural.width * size.width : width * scale,
    height: height === undefined ? natural.height * size.height : height * scale,
  };
}

export function componentPixelTransform(component, natural) {
  if (!(natural?.width > 0 && natural?.height > 0)) return componentSize(component);
  const size = componentPixelSize(component, natural);
  return { width: size.width / natural.width, height: size.height / natural.height };
}
