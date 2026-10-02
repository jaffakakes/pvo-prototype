import { evaluateAnimation } from "../pvo-animation/index.js";

export const TEXT_FONTS = {
  sans: '"Open Sauce Sans", Arial, sans-serif',
  display: '"Peace Sans", "Arial Black", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", monospace',
  condensed: 'Impact, "Arial Narrow", sans-serif',
};
export const DEFAULT_TEXT_STYLE = { font: "sans", size: 18, bold: true, italic: false, underline: false, fill: "#ffffff", background: "transparent", stroke: "#000000", strokeWidth: 0, shadow: false, align: "center", spacing: 0, lineHeight: 1.2, opacity: 1, rotation: 0, box: false };
const palettes = [["#F2F0E9", "#111111"], ["#FF2D78", "#F2F0E9"], ["#FFD23E", "#111111"], ["#2EC4B6", "#111111"], ["#111117", "#F2F0E9"]];
export const TEXT_PRESETS = [
  { id: "clean", name: "Clean", sample: "Your words", style: { ...DEFAULT_TEXT_STYLE } },
  { id: "headline", name: "Headline", sample: "BIG IDEAS", style: { ...DEFAULT_TEXT_STYLE, font: "condensed", size: 28, fill: "#FFD23E", shadow: true } },
  { id: "caption", name: "Outline", sample: "Say it loud", style: { ...DEFAULT_TEXT_STYLE, font: "display", strokeWidth: 1.8, shadow: true } },
  { id: "label", name: "Label", sample: "A little story", style: { ...DEFAULT_TEXT_STYLE, font: "display", fill: "#111111", background: "#FFD23E", box: true } },
  { id: "editorial", name: "Editorial", sample: "A moment in time", style: { ...DEFAULT_TEXT_STYLE, font: "serif", size: 23, bold: false, italic: true } },
  { id: "typewriter", name: "Typewriter", sample: "chapter one", style: { ...DEFAULT_TEXT_STYLE, font: "mono", size: 16, bold: false, background: "#111117", spacing: 1 } },
];

export function textStyle(overlay) {
  if (overlay.style) return { ...DEFAULT_TEXT_STYLE, ...overlay.style };
  const [background, fill] = palettes[overlay.color] || palettes[2];
  return { ...DEFAULT_TEXT_STYLE, font: "display", background, fill, box: true };
}

function setFont(ctx, style, unit) {
  ctx.font = `${style.italic ? "italic " : ""}${style.bold ? "700 " : "400 "}${style.size * unit}px ${TEXT_FONTS[style.font] || TEXT_FONTS.sans}`;
  ctx.letterSpacing = `${style.spacing * unit}px`;
}

export function layoutText(ctx, width, height, overlay, time = 0) {
  const motion = evaluateAnimation(overlay.animation, time);
  const authored = textStyle(overlay);
  const style = { ...authored, rotation: authored.rotation + motion.rotation, opacity: authored.opacity * motion.opacity };
  const unit = width / 247;
  setFont(ctx, style, unit);
  const padX = style.background !== "transparent" ? style.size * unit * .55 : style.strokeWidth * unit + 2 * unit;
  const padY = style.background !== "transparent" ? style.size * unit * .2 : style.strokeWidth * unit + 2 * unit;
  const max = Math.max(1, width * .9 - padX * 2);
  const lines = [];
  for (const paragraph of String(overlay.text || "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && ctx.measureText(line + word).width > max) { lines.push(line.trimEnd()); line = ""; }
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > max) { lines.push(line); line = ""; }
        if (line || char.trim()) line += char;
      }
    }
    lines.push(line);
  }
  const w = Math.max(style.size * unit, ...lines.map(line => ctx.measureText(line).width)) + padX * 2;
  const h = lines.length * style.size * unit * style.lineHeight + padY * 2;
  return { style, unit, lines, width: w, height: h, x: width * (overlay.x + motion.x) / 100 - w / 2, y: height * (overlay.y + motion.y) / 100 - h / 2, padX, padY, scaleX: motion.scaleX, scaleY: motion.scaleY };
}

/** Shared painter: the editor, flat export and interactive player use identical text. */
export function drawText(ctx, width, height, overlay, time = 0) {
  ctx.save();
  const box = layoutText(ctx, width, height, overlay, time);
  const { style: s, unit: u, lines, width: w, height: h, padX, padY } = box;
  ctx.translate(box.x + w / 2, box.y + h / 2);
  ctx.rotate(s.rotation * Math.PI / 180);
  ctx.scale(box.scaleX, box.scaleY);
  ctx.globalAlpha = s.opacity;
  if (s.background !== "transparent") {
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, (s.box ? 10 : 3) * u);
    if (s.box) { ctx.shadowColor = "#000"; ctx.shadowOffsetX = 3 * u; ctx.shadowOffsetY = 3 * u; }
    ctx.fillStyle = s.background; ctx.fill();
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if (s.box) { ctx.strokeStyle = "#000"; ctx.lineWidth = 2.5 * u; ctx.stroke(); }
  }
  setFont(ctx, s, u);
  ctx.textAlign = s.align; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  ctx.fillStyle = s.fill; ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth * u * 2;
  if (s.shadow) { ctx.shadowColor = "#000b"; ctx.shadowBlur = 3 * u; ctx.shadowOffsetY = 2 * u; }
  const x = s.align === "left" ? -w / 2 + padX : s.align === "right" ? w / 2 - padX : 0;
  lines.forEach((line, index) => {
    const y = -h / 2 + padY + (index + .5) * s.size * u * s.lineHeight;
    if (s.strokeWidth > 0) ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
    if (s.underline) {
      const length = ctx.measureText(line).width;
      ctx.fillRect(x - (s.align === "center" ? length / 2 : s.align === "right" ? length : 0), y + s.size * u * .45, length, Math.max(u, s.size * u * .05));
    }
  });
  ctx.restore();
  return box;
}
