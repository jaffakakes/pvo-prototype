export type TextStyle = { font: "sans" | "display" | "serif" | "mono" | "condensed"; size: number; bold: boolean; italic: boolean; underline: boolean; fill: string; background: string; stroke: string; strokeWidth: number; shadow: boolean; align: "left" | "center" | "right"; spacing: number; lineHeight: number; opacity: number; rotation: number; box: boolean };
type Overlay = { text: string; x: number; y: number; color?: number; style?: Partial<TextStyle> };
export const TEXT_FONTS: Record<TextStyle["font"], string>;
export const DEFAULT_TEXT_STYLE: TextStyle;
export const TEXT_PRESETS: { id: string; name: string; sample: string; style: TextStyle }[];
export function textStyle(overlay: Overlay): TextStyle;
export function layoutText(ctx: CanvasRenderingContext2D, width: number, height: number, overlay: Overlay): { style: TextStyle; unit: number; lines: string[]; width: number; height: number; x: number; y: number; padX: number; padY: number };
export function drawText(ctx: CanvasRenderingContext2D, width: number, height: number, overlay: Overlay): ReturnType<typeof layoutText>;
