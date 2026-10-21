/** Fit the project inside the available content box without a minimum size. */
export function fitPreviewSize(
  width: number,
  height: number,
  [ratioWidth, ratioHeight]: [number, number],
) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(width / ratioWidth, height / ratioHeight);
  return { width: ratioWidth * scale, height: ratioHeight * scale };
}

/** Keep 44px editing controls beside the video, or reserve a row below it. */
export function fitPlayerPreview(
  width: number,
  height: number,
  ratio: [number, number],
  centered: boolean,
) {
  const fitted = fitPreviewSize(width, height, ratio);
  const sideGap = (width - fitted.width) / 2;
  const bottomGap = centered ? (height - fitted.height) / 2 : 0;
  // Undo + redo occupy 92px, with 8px outer padding and 4px video clearance.
  const controlsInset = sideGap < 104 && bottomGap < 52 ? 52 : 0;
  return {
    ...fitPreviewSize(width, height - controlsInset, ratio),
    controlsInset,
  };
}
