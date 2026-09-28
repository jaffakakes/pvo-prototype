export const RING_CIRCUMFERENCE = 2 * Math.PI * 41;
// The ring is a ruler, not a recording limit. Once it fills, widen the ruler.
export function ringScale(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 10)
    return 10;
  if (seconds <= 60)
    return 60;
  let scale = 60;
  while (scale < seconds)
    scale *= 2;
  return scale;
}
export type RingItem = {
  id: number | "live";
  seconds: number;
  color: string;
};
export function ringArcs(items: RingItem[], scale: number) {
  let used = 0;
  return items.map(item => {
    const start = used;
    const seconds = Math.max(0, item.seconds);
    used += seconds;
    const length = Math.min(seconds / scale, 1) * RING_CIRCUMFERENCE;
    const gap = Math.min(4, length * .2);
    return { ...item, offset: -start / scale * RING_CIRCUMFERENCE, length: Math.max(0, length - gap) };
  });
}
