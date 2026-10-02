import type { AnimationGroup, AuthoringValue } from "../../domain/animation/authoring";

export const GROUP_LABELS: Record<AnimationGroup, string> = {
  position: "Position", scale: "Scale", rotation: "Rotate", opacity: "Opacity", volume: "Volume",
};

export function formatKeyTime(seconds: number): string {
  const value = Math.round(Math.max(0, seconds) * 10) / 10;
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

export function formatKeyValue(group: AnimationGroup, value: AuthoringValue): string {
  if (typeof value !== "number") {
    const signed = (n: number) => `${Math.round(n) > 0 ? "+" : Math.round(n) < 0 ? "−" : ""}${Math.abs(Math.round(n))}`;
    return `x ${signed(value.x - 50)} · y ${signed(value.y - 50)}`;
  }
  if (group === "scale") return `${Number(value.toFixed(2))}×`;
  if (group === "rotation") return `${Math.round(value)}°`;
  return `${Math.round(value)}%`;
}

export const CONTROL_RANGES = {
  scale: { min: .5, max: 2, step: .01 },
  rotation: { min: -180, max: 180, step: 1 },
  opacity: { min: 0, max: 100, step: 1 },
  volume: { min: 0, max: 100, step: 1 },
} as const;
