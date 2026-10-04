import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { fontFamily } from "../../../../packages/pvo-fonts/index.js";
import { componentPixelSize, LOOK_SIZES, normalizeLook } from "../../../../packages/pvo-component-runtime/index.js";
import { formFieldControls } from "../../domain/components/forms";
import { componentButtonCount } from "../../domain/components/look";
import type { PvoComponent } from "../../domain/project/model";

type Look = ReturnType<typeof normalizeLook>;
type Box = { width: number; height: number; paint: (ctx: CanvasRenderingContext2D) => void };
type Align = "left" | "center" | "right";
type Typography = { heading: string; body: string };

const COLOR = {
  light: "#F2F0E9", dark: "#15151C", ink: "#111111", black: "#000000",
  violet: "#A78BFA", accent: "#FF2D78", input: "#1C1C24",
};
const DISPLAY = '"Peace Sans", "Arial Black", sans-serif';
const UI = '"Open Sauce Sans", system-ui, sans-serif';

function font(ctx: CanvasRenderingContext2D, size: number, weight = 600, family = UI) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function wrap(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
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

function linesWidth(ctx: CanvasRenderingContext2D, lines: string[]) {
  return Math.max(0, ...lines.map(line => ctx.measureText(line).width));
}

function text(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, width: number,
  size: number, lineHeight: number, color: string, align: Align, weight = 600, family = UI) {
  ctx.save();
  font(ctx, size, weight, family);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const anchor = align === "left" ? x : align === "right" ? x + width : x + width / 2;
  lines.forEach((line, index) => ctx.fillText(line, anchor, y + index * lineHeight));
  ctx.restore();
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  fill: string, border: string, radius: number, borderWidth: number, shadow = 0) {
  ctx.save();
  if (shadow) {
    ctx.fillStyle = COLOR.black;
    ctx.beginPath();
    ctx.roundRect(x + shadow, y + shadow, width, height, radius);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  if (fill !== "none") { ctx.fillStyle = fill; ctx.fill(); }
  if (border !== "none") { ctx.lineWidth = borderWidth; ctx.strokeStyle = border; ctx.stroke(); }
  ctx.restore();
}

function button(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  label: string, look: Look | null, index: number, defaultFill: string, defaultText: string,
  radius: number, size: number, family: string, shadow = 0) {
  const styled = look?.btns[index];
  const fill = styled?.fill ?? defaultFill;
  panel(ctx, x, y, width, height, fill, styled?.border ?? COLOR.black,
    styled?.radius ?? radius, 2, look ? 0 : shadow);
  const fontSize = styled ? LOOK_SIZES.button[styled.size] : size;
  ctx.save();
  font(ctx, fontSize, styled?.weight ?? 800, family);
  const max = Math.max(0, width - 16);
  let caption = label;
  while (caption.length > 1 && ctx.measureText(caption).width > max)
    caption = `${caption.slice(0, -2)}…`;
  ctx.restore();
  text(ctx, [caption], x + 8, y + (height - fontSize * 1.1) / 2, width - 16,
    fontSize, fontSize * 1.1, styled?.text ?? defaultText, "center", styled?.weight ?? 800, family);
}

function tooltip(ctx: CanvasRenderingContext2D, component: PvoComponent, look: Look | null, unit: number, typography: Typography): Box {
  const bodySize = look ? LOOK_SIZES.body[look.body.size] : 10.5;
  const bodyWeight = look?.body.weight ?? 700;
  const border = look ? 2 : 2 / unit;
  const padX = look ? 12 : 10, padY = look ? 12 : 6;
  const dot = look ? 0 : 7, gap = look ? 0 : 6;
  font(ctx, bodySize, bodyWeight, typography.body);
  const lines = wrap(ctx, component.fields.text || "Tap to learn more", 216 - 2 * (padX + border) - dot - gap);
  const bodyWidth = linesWidth(ctx, lines), bodyHeight = lines.length * bodySize * (look ? 1.4 : 1.25);
  const width = Math.min(216, Math.max(2 * (padX + border) + dot + gap + bodyWidth, 36));
  const height = 2 * (padY + border) + Math.max(dot, bodyHeight);
  return { width, height, paint(painter) {
    panel(painter, 0, 0, width, height, look?.whole.bg ?? COLOR.light,
      look?.whole.border ?? COLOR.black, look?.whole.radius ?? 9, border, look ? 0 : 2 / unit);
    const contentY = (height - bodyHeight) / 2;
    if (!look) {
      panel(painter, padX + border, (height - dot) / 2, dot, dot, COLOR.violet, COLOR.black, dot / 2, 1.5 / unit);
    }
    text(painter, lines, padX + border + dot + gap, contentY,
      width - 2 * (padX + border) - dot - gap, bodySize, bodySize * (look ? 1.4 : 1.25),
      look?.body.color ?? COLOR.ink, look?.body.align ?? "left", bodyWeight, typography.body);
  } };
}

function card(ctx: CanvasRenderingContext2D, component: PvoComponent, look: Look | null, unit: number, typography: Typography): Box {
  const width = 190, pad = 12, border = look ? 2 : 2.5 / unit;
  const inner = width - 2 * (pad + border);
  const headingSize = look ? LOOK_SIZES.heading[look.heading.size] : 14;
  const bodySize = look ? LOOK_SIZES.body[look.body.size] : 10.5;
  font(ctx, headingSize, 400, typography.heading);
  const heading = wrap(ctx, component.fields.title || "Title", inner);
  font(ctx, bodySize, look?.body.weight ?? 600, typography.body);
  const body = wrap(ctx, component.fields.body || "Text", inner);
  const headingHeight = heading.length * headingSize * (look ? 1.2 : 1);
  const bodyHeight = body.length * bodySize * (look ? 1.4 : 1.3);
  const buttons = component.fields.buttons?.slice(0, 2) ?? [];
  const buttonHeight = buttons.length ? Math.max(30, ...buttons.map((_, index) => {
    const size = look?.btns[index]?.size;
    return size ? LOOK_SIZES.height[size] : 30;
  })) : 0;
  const afterHeading = look ? 8 : 7;
  const afterBody = buttons.length ? look ? 9 + 8 : 8 : look ? 9 : 7;
  const height = 2 * (pad + border) + headingHeight + afterHeading + bodyHeight + afterBody + buttonHeight;
  return { width, height, paint(painter) {
    panel(painter, 0, 0, width, height, look?.whole.bg ?? COLOR.dark,
      look?.whole.border ?? COLOR.black, look?.whole.radius ?? 14, border, look ? 0 : 3 / unit);
    const left = pad + border;
    let y = pad + border;
    text(painter, heading, left, y, inner, headingSize, headingSize * (look ? 1.2 : 1),
      look?.heading.color ?? COLOR.light, look?.heading.align ?? "left", 400, typography.heading);
    y += headingHeight + afterHeading;
    text(painter, body, left, y, inner, bodySize, bodySize * (look ? 1.4 : 1.3),
      look?.body.color ?? "rgba(242,240,233,.7)", look?.body.align ?? "left", look?.body.weight ?? 600, typography.body);
    y += bodyHeight + afterBody;
    const gap = 6;
    const buttonWidth = (inner - gap * (buttons.length - 1)) / Math.max(1, buttons.length);
    buttons.forEach((item, index) => button(painter, left + index * (buttonWidth + gap), y,
      buttonWidth, buttonHeight, item.label || `Button ${index + 1}`, look, index,
      index ? COLOR.dark : COLOR.light, index ? COLOR.light : COLOR.ink, 8, 10.5, typography.body));
  } };
}

function choice(ctx: CanvasRenderingContext2D, component: PvoComponent, look: Look | null, unit: number, typography: Typography): Box {
  const width = 176;
  const headingSize = look ? LOOK_SIZES.heading[look.heading.size] : 13;
  font(ctx, headingSize, 400, typography.heading);
  const heading = wrap(ctx, component.fields.prompt || "Which one?", width - (look ? 0 : 24));
  const headingHeight = heading.length * headingSize * (look ? 1.2 : 1) + (look ? 0 : 12 + 2 * 2.5 / unit);
  const headingWidth = look ? width : Math.min(width, linesWidth(ctx, heading) + 22 + 2 * 2.5 / unit);
  const buttonHeight = Math.max(36, ...[0, 1].map(index => look?.btns[index]
    ? LOOK_SIZES.height[look.btns[index].size] : 36));
  const gap = 7;
  const height = headingHeight + (look ? 8 : 0) + gap * 2 + buttonHeight * 2;
  return { width, height, paint(painter) {
    if (!look) panel(painter, (width - headingWidth) / 2, 0, headingWidth, headingHeight,
      COLOR.violet, COLOR.black, 10, 2.5 / unit, 3 / unit);
    text(painter, heading, (width - headingWidth) / 2, look ? 0 : (headingHeight - heading.length * headingSize) / 2,
      headingWidth, headingSize, headingSize * (look ? 1.2 : 1),
      look?.heading.color ?? COLOR.ink, look?.heading.align ?? "center", 400, typography.heading);
    const first = headingHeight + (look ? 8 : 0) + gap;
    for (let index = 0; index < 2; index++) button(painter, 0, first + index * (buttonHeight + gap),
      width, buttonHeight, component.fields.options?.[index]?.label || `Option ${String.fromCharCode(65 + index)}`,
      look, index, COLOR.light, COLOR.ink, 10, 12, typography.body, 3 / unit);
  } };
}

function form(ctx: CanvasRenderingContext2D, component: PvoComponent, look: Look | null, unit: number, typography: Typography): Box {
  const width = 190, pad = 12, border = look ? 2 : 2.5 / unit;
  const inner = width - 2 * (pad + border);
  const headingSize = look ? LOOK_SIZES.heading[look.heading.size] : 14;
  const bodySize = look ? LOOK_SIZES.body[look.body.size] : 10;
  font(ctx, headingSize, 400, typography.heading);
  const heading = component.fields.heading ? wrap(ctx, component.fields.heading, inner) : [];
  const controls = formFieldControls(component.fields);
  const headingHeight = heading.length * headingSize * (look ? 1.2 : 1);
  const fieldHeight = Math.max(30, look ? 29 : 30);
  const labelHeight = bodySize * 1.2;
  const controlHeight = labelHeight + 3 + fieldHeight;
  const fieldsHeight = controls.length * controlHeight + Math.max(0, controls.length - 1) * 6;
  const buttonHeight = Math.max(34, look ? LOOK_SIZES.height[look.btns[0]?.size ?? "M"] : 34);
  const height = 2 * (pad + border) + headingHeight + (heading.length && look ? 8 : 0)
    + 14 + fieldsHeight + 5 + buttonHeight;
  return { width, height, paint(painter) {
    panel(painter, 0, 0, width, height, look?.whole.bg ?? COLOR.dark,
      look?.whole.border ?? COLOR.black, look?.whole.radius ?? 14, border, look ? 0 : 3 / unit);
    const left = pad + border;
    let y = pad + border;
    if (heading.length) {
      text(painter, heading, left, y, inner, headingSize, headingSize * (look ? 1.2 : 1),
        look?.heading.color ?? COLOR.light, look?.heading.align ?? "left", 400, typography.heading);
      y += headingHeight + (look ? 8 : 0);
    }
    y += 7;
    controls.forEach((control, index) => {
      text(painter, [control.label], left, y, inner, bodySize, labelHeight,
        look?.body.color ?? COLOR.light, look?.body.align ?? "left", look?.body.weight ?? 600, typography.body);
      y += labelHeight + 3;
      panel(painter, left, y, inner, fieldHeight, look ? "none" : COLOR.input,
        look?.body.color ?? "#8F8D95", look ? Math.min(look.whole.radius, 14) : 7, look ? 1 : 1.5 / unit);
      text(painter, [control.type === "yesno" ? "No" : control.label], left + 8, y + (fieldHeight - bodySize * 1.2) / 2,
        inner - 16, bodySize, bodySize * 1.2, look?.body.color ?? COLOR.light, "left", look?.body.weight ?? 600, typography.body);
      y += fieldHeight + (index < controls.length - 1 ? 6 : 0);
    });
    y += 7 + 5;
    button(painter, left, y, inner, buttonHeight, component.fields.submitLabel || "Send",
      look, 0, COLOR.accent, COLOR.light, 8, 10.5, typography.body);
  } };
}

/** Paint a visual PVO component from its authored fields. Code-owned iframe content has no Canvas painter. */
export function paintCoverComponent(ctx: CanvasRenderingContext2D, width: number, height: number,
  component: PvoComponent, time: number): void {
  if (component.code?.custom) return;
  const unit = width / 247;
  const motion = evaluateAnimation(component.animation, time - component.at);
  const family = component.font ? `"${fontFamily(component.font)}"` : null;
  const typography = { heading: family ?? DISPLAY, body: family ?? UI };
  const look = component.look ? normalizeLook(component.look, componentButtonCount(component)) : null;
  const box = component.type === "tooltip" ? tooltip(ctx, component, look, unit, typography)
    : component.type === "card" ? card(ctx, component, look, unit, typography)
    : component.type === "choice" ? choice(ctx, component, look, unit, typography)
    : form(ctx, component, look, unit, typography);
  const desired = componentPixelSize(component, { width: box.width * unit, height: box.height * unit });
  // Composite once: DOM layer opacity applies to the complete card, not each overlapping shape.
  const padding = 8;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((box.width + padding * 2) * unit);
  canvas.height = Math.ceil((box.height + padding * 2) * unit);
  const layer = canvas.getContext("2d");
  if (!layer) throw new Error(`Could not draw cover component ${component.id}.`);
  layer.scale(unit, unit);
  layer.translate(padding, padding);
  box.paint(layer);
  ctx.save();
  ctx.globalAlpha = motion.opacity;
  ctx.translate(width * (component.x + motion.x) / 100, height * (component.y + motion.y) / 100);
  ctx.rotate(motion.rotation * Math.PI / 180);
  ctx.scale(desired.width / (box.width * unit) * motion.scaleX, desired.height / (box.height * unit) * motion.scaleY);
  ctx.drawImage(canvas, -(box.width / 2 + padding) * unit, -(box.height / 2 + padding) * unit);
  ctx.restore();
}
