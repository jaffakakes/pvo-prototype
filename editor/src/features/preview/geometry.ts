/** Fit the project inside the available content box without a minimum size. */
export function fitPreviewSize(width: number, height: number, [ratioWidth, ratioHeight]: [number, number]) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(width / ratioWidth, height / ratioHeight);
  return { width: ratioWidth * scale, height: ratioHeight * scale };
}
