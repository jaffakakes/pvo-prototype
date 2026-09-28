/** Shared visual values for the no-code editor and the standalone player. */
export { MIN_COMPONENT_SCALE, MAX_COMPONENT_SCALE, MAX_COMPONENT_PIXELS, canvasPixelSize, componentPixelDimension, componentPixelSize, componentPixelTransform, componentScale, componentSize } from "./size.js";
export { observeComponentSize } from "./measure.js";

export const LOOK_PRESETS = ["bold", "soft", "minimal", "contrast"];
export const LOOK_NAMES = { bold: "Bold", soft: "Soft", minimal: "Minimal", contrast: "High contrast", custom: "Custom" };
export const LOOK_PALETTE = ["#F2F0E9", "#15151C", "#000000", "#A78BFA", "#FF9FBC", "#2EC4B6", "#FFD23E", "#00E5A0", "#FF5C5C", "#FF9F43", "#5B8DEF"];
export const LOOK_SIZES = {
  heading: { S: 12, M: 14, L: 17, XL: 20 },
  body: { S: 9, M: 10.5, L: 12, XL: 13.5 },
  button: { S: 10, M: 11, L: 12.5, XL: 14 },
  height: { S: 26, M: 30, L: 34, XL: 38 },
};

export function createLook(preset = "bold", buttonCount = 2) {
  const base = LOOK_PRESETS.includes(preset) ? preset : "bold";
  const light = "#F2F0E9", dark = "#15151C", black = "#000000";
  const whole = { bg: dark, border: black, text: light, radius: 14, align: "center" };
  const heading = { color: light, size: "L", align: "center" };
  const body = { color: light, size: "M", weight: 600, align: "center" };
  const button = { fill: "#FF9FBC", text: dark, border: black, size: "M", weight: 800, radius: 14 };
  if (base === "soft") {
    Object.assign(whole, { bg: light, border: light, text: dark, radius: 22 });
    Object.assign(heading, { color: dark, size: "M" });
    Object.assign(body, { color: dark });
    Object.assign(button, { fill: "#C4B3FC", border: "#C4B3FC", weight: 700, radius: 999 });
  } else if (base === "minimal") {
    Object.assign(whole, { bg: "none", border: "none", radius: 6, align: "left" });
    Object.assign(heading, { size: "M", align: "left" });
    Object.assign(body, { size: "S", align: "left" });
    Object.assign(button, { fill: "none", text: light, border: light, size: "S", weight: 700, radius: 6 });
  } else if (base === "contrast") {
    Object.assign(whole, { bg: black, border: light, radius: 0 });
    Object.assign(heading, { color: "#FFD23E", size: "XL" });
    Object.assign(body, { weight: 700 });
    Object.assign(button, { fill: light, text: black, size: "L", radius: 0 });
  }
  return {
    preset: base, basePreset: base, whole, heading, body,
    btns: Array.from({ length: buttonCount }, () => ({ ...button })),
  };
}

export function cloneLook(look) {
  return {
    ...look,
    whole: { ...look.whole },
    heading: { ...look.heading },
    body: { ...look.body },
    btns: look.btns.map(button => ({ ...button })),
  };
}

export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) return `#${hex.split("").map(char => char + char).join("").toUpperCase()}`;
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** Treat serialized visual values as data, including when a package came from another author. */
export function normalizeLook(value, buttonCount = 2) {
  const defaults = createLook(value?.basePreset ?? value?.preset, buttonCount);
  const color = (value, fallback, none = false) => none && value === "none" ? "none" : normalizeHex(value) ?? fallback;
  const size = (value, fallback) => ["S", "M", "L", "XL"].includes(value) ? value : fallback;
  const weight = (value, fallback) => [600, 700, 800].includes(value) ? value : fallback;
  const radius = (value, fallback) => [0, 6, 14, 22, 999].includes(value) ? value : fallback;
  const align = (value, fallback) => ["left", "center", "right"].includes(value) ? value : fallback;
  const result = cloneLook(defaults);
  result.preset = [...LOOK_PRESETS, "custom"].includes(value?.preset) ? value.preset : defaults.preset;
  for (const key of ["bg", "border", "text"]) {
    result.whole[key] = color(value?.whole?.[key], defaults.whole[key], key !== "text");
  }
  result.whole.radius = radius(value?.whole?.radius, defaults.whole.radius);
  result.whole.align = align(value?.whole?.align, defaults.whole.align);
  for (const key of ["heading", "body"]) {
    result[key].color = color(value?.[key]?.color, defaults[key].color);
    result[key].size = size(value?.[key]?.size, defaults[key].size);
    result[key].align = align(value?.[key]?.align, defaults[key].align);
  }
  result.body.weight = weight(value?.body?.weight, defaults.body.weight);
  result.btns = result.btns.map((button, index) => {
    const input = value?.btns?.[index];
    return {
      fill: color(input?.fill, button.fill, true),
      text: color(input?.text, button.text),
      border: color(input?.border, button.border, true),
      size: size(input?.size, button.size),
      weight: weight(input?.weight, button.weight),
      radius: radius(input?.radius, button.radius),
    };
  });
  return result;
}

/** Pixel units are scaled once by the stage adapter; the values also work in miniature previews. */
export function lookStyles(value, unit = 1, buttonCount = 2) {
  const look = normalizeLook(value, buttonCount);
  const px = value => `${value * unit}px`;
  const paint = value => value === "none" ? "transparent" : value;
  return {
    whole: {
      background: paint(look.whole.bg),
      border: `${px(2)} solid ${paint(look.whole.border)}`,
      borderRadius: px(look.whole.radius),
      color: look.whole.text,
      textAlign: look.whole.align,
      padding: px(12),
      boxShadow: "none",
    },
    heading: {
      background: "transparent", border: "0", padding: "0", boxShadow: "none",
      color: look.heading.color,
      fontSize: px(LOOK_SIZES.heading[look.heading.size]),
      textAlign: look.heading.align,
      fontFamily: '"Peace Sans", "Arial Black", sans-serif',
      lineHeight: "1.2",
      margin: `0 0 ${px(8)}`,
    },
    body: {
      color: look.body.color,
      fontSize: px(LOOK_SIZES.body[look.body.size]),
      fontWeight: look.body.weight,
      textAlign: look.body.align,
      lineHeight: "1.4",
      margin: `0 0 ${px(9)}`,
    },
    buttons: look.btns.map(button => ({
      background: paint(button.fill),
      color: button.text,
      border: `${px(2)} solid ${paint(button.border)}`,
      borderRadius: px(button.radius),
      fontSize: px(LOOK_SIZES.button[button.size]),
      fontWeight: button.weight,
      minHeight: px(LOOK_SIZES.height[button.size]),
      boxShadow: "none",
      padding: `${px(5)} ${px(8)}`,
      lineHeight: "1.2",
    })),
    field: {
      fontSize: px(LOOK_SIZES.body[look.body.size]),
      fontWeight: look.body.weight,
      color: look.body.color,
      textAlign: look.body.align,
      background: "transparent",
      border: `${px(1)} solid currentColor`,
      borderRadius: px(Math.min(look.whole.radius, 14)),
      minHeight: px(29),
      padding: px(6),
      width: "100%",
      boxSizing: "border-box",
    },
  };
}
