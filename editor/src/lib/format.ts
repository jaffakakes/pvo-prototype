export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
export const fmt = (value: number) => {
  const seconds = Math.floor(Math.max(0, value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
export const round2 = (value: number) => Math.round(value * 100) / 100;
