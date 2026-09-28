import { normalizeHex } from "./look";

export function hueLightness(hex: string): [number, number] {
  const normalized = normalizeHex(hex) ?? "#FF9FBC";
  const [r, g, b] = [1, 3, 5].map(index => parseInt(normalized.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [Math.round(hue * 60), Math.round((max + min) * 50)];
}

/** The visual editor fixes saturation at 80 percent. */
export function hueColor(hue: number, lightness: number): string {
  const l = lightness / 100;
  const a = .8 * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}
