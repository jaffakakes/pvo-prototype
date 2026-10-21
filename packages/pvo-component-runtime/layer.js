/** Layer appearance composes outside authored content and its isolated renderer. */
export function componentOpacity(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 1;
}
export function componentRotation(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-45, Math.min(45, value))
    : 0;
}
export function componentLayerMotion(component, motion) {
  return {
    ...motion,
    opacity: motion.opacity * componentOpacity(component?.opacity),
    rotation: motion.rotation + componentRotation(component?.rotation),
  };
}
