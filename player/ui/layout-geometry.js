const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** Fit the authored canvas without cropping; all rectangles use stage pixels. */
export function fitFootage(width, height, aspect) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 9 / 16;
  let videoWidth = Math.round(height * ratio);
  let videoHeight = height;
  if (videoWidth > width) {
    videoWidth = width;
    videoHeight = Math.round(width / ratio);
  }
  return {
    left: Math.round((width - videoWidth) / 2),
    top: Math.round((height - videoHeight) / 2),
    width: videoWidth,
    height: videoHeight,
  };
}

export function footageComponentScale(footage) {
  const wide = footage.width / footage.height > 1;
  return Math.min(1.5, footage.width / (wide ? 390 : 348));
}

/** Lift the existing authored content as one unit, keeping its original shape. */
export function placeComponent({ stage, footage, bounds, keyboard = false, large = false, occupied = [], preservePosition = false }) {
  // Fitting must not pull animated exits back on-screen or uncover a layer
  // beneath the footage. A focused form can still move above the keyboard.
  if (preservePosition && !keyboard) return { ...bounds, scale: 1, direction: "" };
  const scale = footageComponentScale(footage);
  const needsLift = keyboard || scale < 0.8 || bounds.height / footage.height > 0.35;
  const horizontal = bounds.width <= footage.width - 16
    ? { start: footage.left + 8, end: footage.left + footage.width - bounds.width - 8 }
    : { start: 8, end: Math.max(8, stage.width - bounds.width - 8) };
  const vertical = bounds.height <= footage.height - 16
    ? { start: footage.top + 8, end: footage.top + footage.height - bounds.height - 8 }
    : { start: 8, end: Math.max(8, stage.height - bounds.height - 8) };
  const unchanged = {
    ...bounds,
    left: clamp(bounds.left, horizontal.start, horizontal.end),
    top: clamp(bounds.top, vertical.start, vertical.end),
    scale: 1, direction: "",
  };
  if (!needsLift || scale <= 0) return unchanged;
  const liftScale = (keyboard ? 1 : large ? 1.2 : 1) / scale;
  const width = bounds.width * liftScale;
  const height = bounds.height * liftScale;
  const bottom = footage.top + footage.height;
  let result;
  if (keyboard) {
    result = { left: (stage.width - width) / 2, top: stage.contentHeight + 8, width, height };
  } else if (stage.height - bottom >= height + 28 && width <= stage.width - 24) {
    result = { left: (stage.width - width) / 2, top: bottom + 14, width, height };
  } else if (stage.width - (footage.left + footage.width) >= width + 40 && height <= stage.height - 24) {
    result = { left: footage.left + footage.width + 24, top: (stage.height - height) / 2, width, height };
  } else {
    return unchanged;
  }
  if (occupied.some(other => rectanglesIntersect(result, other, 8))) return unchanged;
  return { ...result, scale: liftScale, direction: keyboard ? "keyboard" : result.top === bottom + 14 ? "below" : "right" };
}

export function rectanglesIntersect(first, second, gap = 0) {
  return first.left < second.left + second.width + gap
    && first.left + first.width + gap > second.left
    && first.top < second.top + second.height + gap
    && first.top + first.height + gap > second.top;
}

/** Prefer the design's corner, then use an empty vertical gap for unusual layouts. */
export function placeSticker(preferred, stage, obstacles) {
  const x = clamp(preferred.left, 12, Math.max(12, stage.width - preferred.width - 12));
  const maxTop = Math.max(12, stage.height - preferred.height - 12);
  const tops = [preferred.top, 12, maxTop];
  obstacles.forEach(rect => {
    tops.push(rect.top - preferred.height - 8, rect.top + rect.height + 8);
  });
  for (const top of tops) {
    const candidate = { ...preferred, left: x, top: clamp(top, 12, maxTop) };
    if (!obstacles.some(rect => rectanglesIntersect(candidate, rect, 6))) {
      return { ...candidate, hidden: false };
    }
  }
  return { ...preferred, left: x, hidden: true };
}
