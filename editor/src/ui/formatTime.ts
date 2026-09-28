export const fmt = (value: number) => {
  const seconds = Math.floor(Math.max(0, value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
export function pickTime(seconds: number) {
  const tenths = Math.round(seconds * 10);
  return `${fmt(tenths / 10)}.${tenths % 10}`;
}
