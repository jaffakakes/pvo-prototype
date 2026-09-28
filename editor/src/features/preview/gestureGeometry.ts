export type GesturePoint = { x: number; y: number };

export function gestureGeometry(points: GesturePoint[]) {
  const [first, second] = points;
  return second ? {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
  } : { ...first, distance: 1 };
}
