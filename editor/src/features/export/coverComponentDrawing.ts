import {
  LOOK_SIZES,
  normalizeLook,
} from "../../../../packages/pvo-component-runtime/index.js";

export type Look = ReturnType<typeof normalizeLook>;
export type Box = {
  width: number;
  height: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
};
type Align = "left" | "center" | "right";
export type Typography = { heading: string; body: string };

export const COLOR = {
  light: "#F2F0E9",
  dark: "#15151C",
  ink: "#111111",
  black: "#000000",
  violet: "#A78BFA",
  accent: "#FF2D78",
  input: "#1C1C24",
};
const UI = '"Open Sauce Sans", system-ui, sans-serif';

export function font(
  ctx: CanvasRenderingContext2D,
  size: number,
  weight = 600,
  family = UI,
) {
  ctx.font = `${weight} ${size}px ${family}`;
}

export function wrap(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of String(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function linesWidth(ctx: CanvasRenderingContext2D, lines: string[]) {
  return Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
}

export function text(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  width: number,
  size: number,
  lineHeight: number,
  color: string,
  align: Align,
  weight = 600,
  family = UI,
) {
  ctx.save();
  font(ctx, size, weight, family);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const anchor =
    align === "left" ? x : align === "right" ? x + width : x + width / 2;
  lines.forEach((line, index) =>
    ctx.fillText(line, anchor, y + index * lineHeight),
  );
  ctx.restore();
}

export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  border: string,
  radius: number,
  borderWidth: number,
  shadow = 0,
) {
  ctx.save();
  if (shadow) {
    ctx.fillStyle = COLOR.black;
    ctx.beginPath();
    ctx.roundRect(x + shadow, y + shadow, width, height, radius);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  if (fill !== "none") {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (border !== "none") {
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
  ctx.restore();
}

export function button(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  look: Look | null,
  index: number,
  defaultFill: string,
  defaultText: string,
  radius: number,
  size: number,
  family: string,
  shadow = 0,
) {
  const styled = look?.btns[index];
  const fill = styled?.fill ?? defaultFill;
  panel(
    ctx,
    x,
    y,
    width,
    height,
    fill,
    styled?.border ?? COLOR.black,
    styled?.radius ?? radius,
    2,
    look ? 0 : shadow,
  );
  const fontSize = styled ? LOOK_SIZES.button[styled.size] : size;
  ctx.save();
  font(ctx, fontSize, styled?.weight ?? 800, family);
  const max = Math.max(0, width - 16);
  let caption = label;
  while (caption.length > 1 && ctx.measureText(caption).width > max)
    caption = `${caption.slice(0, -2)}…`;
  ctx.restore();
  text(
    ctx,
    [caption],
    x + 8,
    y + (height - fontSize * 1.1) / 2,
    width - 16,
    fontSize,
    fontSize * 1.1,
    styled?.text ?? defaultText,
    "center",
    styled?.weight ?? 800,
    family,
  );
}
