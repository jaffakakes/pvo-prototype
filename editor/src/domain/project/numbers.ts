export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
export const round2 = (value: number) => Math.round(value * 100) / 100;
