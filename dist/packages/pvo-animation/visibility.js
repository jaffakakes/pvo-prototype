const EPSILON = 0.000001;

/** Zero opacity or a collapsed axis must never leave an invisible interactive control. */
export function visualMotionVisible(motion) {
  return motion.opacity > EPSILON && motion.scaleX > EPSILON && motion.scaleY > EPSILON;
}

/** Inverse CSS center transform against the opaque full-canvas video rectangle. */
export function videoCoversPoint(motion, point, aspectRatio = 1) {
  if (!visualMotionVisible(motion) || motion.opacity < 1 - EPSILON) return false;
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const x = (point.x - 50 - motion.x) / 100 * aspect;
  const y = (point.y - 50 - motion.y) / 100;
  const radians = motion.rotation * Math.PI / 180;
  const unrotatedX = x * Math.cos(radians) + y * Math.sin(radians);
  const unrotatedY = -x * Math.sin(radians) + y * Math.cos(radians);
  return Math.abs(unrotatedX / motion.scaleX) <= aspect / 2 + EPSILON
    && Math.abs(unrotatedY / motion.scaleY) <= 0.5 + EPSILON;
}

/** Conservative anchor test: never require an answer when its animated center is off canvas. */
export function animatedCenterVisible(motion, center) {
  if (!visualMotionVisible(motion)) return false;
  const x = center.x + motion.x;
  const y = center.y + motion.y;
  return x >= 0 && x <= 100 && y >= 0 && y <= 100;
}
