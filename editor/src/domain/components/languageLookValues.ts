import { createLook, normalizeLook, LOOK_SIZES, type ComponentLook, type LookSize, type LookRadius, type LookWeight, type LookAlign } from "../../../../packages/pvo-component-runtime/index.js";
import type { PvoLanguageStructure } from "../../../../packages/pvo-language/index.js";
import type { PvoComponent } from "../project/model";
import { effectiveStyle, readLookStyle, type StyleRule, type StyleValues } from "./languageLookStyle";

export type LookValuePath = `whole.${"bg" | "border" | "text" | "radius" | "align"}`
  | `heading.${"color" | "size" | "align"}` | `body.${"color" | "size" | "weight" | "align"}`
  | `btns.${number}.${"fill" | "text" | "border" | "size" | "weight" | "radius"}`;
export type LookCustomValues = Partial<Record<LookValuePath, string>>;

export function lookButtonCount(component: PvoComponent): number {
  const structure = component.code?.pvoCompiled?.structure;
  if (structure?.type === "card") return structure.buttons.length;
  return component.type === "choice" ? 2 : component.type === "form" ? 1
    : component.type === "card" ? Math.min(component.fields.buttons?.length ?? 0, 2) : 0;
}

export function authoredLookSource(component: PvoComponent) {
  const code = component.code;
  if (!code?.custom || !code.pvoCompiled || code.pvoCompiled.structure.type !== component.type) return null;
  const source = code.pvoTouched ? code.pvoLastValid : code.pvo;
  if (!source) return null;
  const rules = readLookStyle(source.style, code.pvoCompiled.structure);
  return rules && { source, rules, structure: code.pvoCompiled.structure };
}

function controlIds(component: PvoComponent): string[] {
  const structure = component.code?.pvoCompiled?.structure;
  if (structure?.type === "card") return structure.buttons.map(button => button.id);
  if (structure?.type === "choice") return structure.options.map(option => option.id);
  return Array.from({ length: lookButtonCount(component) }, (_, index) => `${component.type === "choice" ? "option" : "button"}${index}`);
}

/** A deliberate preset replacement still targets authored IDs, never generated guesses. */
export function lookStyleSource(component: PvoComponent, look: ComponentLook): string {
  const color = (value: string) => value === "none" ? "transparent" : value;
  const block = (selector: string, values: Record<string, string | number>) =>
    `${selector} {\n${Object.entries(values).map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n}`;
  const rules = [block(component.type, {
    background: color(look.whole.bg), "border-color": color(look.whole.border), color: look.whole.text,
    "border-radius": `${Math.min(look.whole.radius, 64)}px`, "text-align": look.whole.align,
  })];
  const structure = component.code?.pvoCompiled?.structure;
  const heading = component.type === "card" ? "title" : component.type === "choice" ? "prompt" : "heading";
  const hasHeading = component.type !== "form" || (structure?.type === "form" ? structure.heading !== undefined : Boolean(component.fields.heading?.trim()));
  if (component.type !== "tooltip" && hasHeading) rules.push(block(heading, {
    color: look.heading.color, "font-size": `${LOOK_SIZES.heading[look.heading.size]}px`, "text-align": look.heading.align,
  }));
  if (component.type !== "choice") rules.push(block(component.type === "tooltip" ? "text" : component.type === "form" ? "field" : "body", {
    color: look.body.color, "font-size": `${LOOK_SIZES.body[look.body.size]}px`, "font-weight": look.body.weight, "text-align": look.body.align,
  }));
  const ids = controlIds(component);
  look.btns.forEach((button, index) => rules.push(block(component.type === "form" ? "submit" : `#${ids[index]}`, {
    background: color(button.fill), color: button.text, "border-color": color(button.border),
    "border-radius": `${Math.min(button.radius, LOOK_SIZES.height[button.size] / 2)}px`,
    "font-size": `${LOOK_SIZES.button[button.size]}px`, "font-weight": button.weight,
  })));
  return rules.join("\n\n");
}

function elementValues(rules: readonly StyleRule[], tag: string, root: StyleValues, id?: string, kind?: string): StyleValues {
  const inherited: StyleValues = { color: root.color, "font-size": root["font-size"], "font-weight": root["font-weight"], "text-align": root["text-align"] };
  const defaults: StyleValues = ["title", "prompt", "heading"].includes(tag) ? { "font-size": "19px", "font-weight": "800" }
    : tag === "body" ? { "font-size": "11px", "font-weight": "700" }
      : ["button", "option", "submit"].includes(tag) ? {
        background: tag === "option" ? "#A78BFA" : "#FF2D78", color: tag === "option" ? "#111" : "#F2F0E9",
        "border-color": "#000", "border-radius": "9px", "font-size": "12px", "font-weight": "800", "text-align": "center",
      } : tag === "field" ? { color: "#F2F0E9", ...(kind === "yesno" ? {} : { "font-size": "13.3333px", "font-weight": "400", "text-align": "left" }) } : {};
  return { ...inherited, ...defaults, ...effectiveStyle(rules, tag, id) };
}

function numeric(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Preserve exact authored tokens separately from the visual preset selectors. */
export function projectLookValues(component: PvoComponent): { look: ComponentLook; custom: LookCustomValues } {
  const base = normalizeLook(component.look, lookButtonCount(component));
  const authored = authoredLookSource(component);
  if (!authored) return { look: base, custom: {} };
  if (authored.source.style === lookStyleSource(component, base)) return { look: base, custom: {} };
  const { rules, structure } = authored;
  const look = createLook(base.basePreset, lookButtonCount(component));
  look.preset = "custom";
  const custom: LookCustomValues = {};
  const root: StyleValues = {
    background: component.type === "tooltip" ? "#FFD23E" : component.type === "choice" ? "transparent" : "#15151C",
    color: component.type === "tooltip" ? "#111" : "#F2F0E9",
    "border-color": component.type === "choice" ? "transparent" : "#000",
    "border-radius": "14px", "text-align": "left",
    "font-size": component.type === "tooltip" ? "13px" : "16px", "font-weight": component.type === "tooltip" ? "800" : "400",
    ...effectiveStyle(rules, component.type),
  };
  const rootColor = root.color === "currentColor" ? "#000" : root.color ?? "#F2F0E9";
  const color = (values: StyleValues, property: "background" | "color" | "border-color", path: LookValuePath, inherited = rootColor) => {
    const token = values[property] ?? inherited;
    if (token === "currentColor") custom[path] = token;
    const ownColor = values.color === "currentColor" ? inherited : values.color ?? inherited;
    return token === "currentColor" ? ownColor : token === "transparent" && property !== "color" ? "none" : token;
  };
  const size = (value: string | undefined, sizes: Record<LookSize, number>, path: LookValuePath): LookSize => {
    const pixels = numeric(value, sizes.M);
    const entries = Object.entries(sizes) as [LookSize, number][];
    const chosen = entries.reduce((best, entry) => Math.abs(entry[1] - pixels) < Math.abs(best[1] - pixels) ? entry : best);
    if (chosen[1] !== pixels) custom[path] = value ?? `${pixels}px`;
    return chosen[0];
  };
  const radius = (value: string | undefined, path: LookValuePath, pill: number): LookRadius => {
    const pixels = numeric(value, 14);
    if (pixels === pill) return 999;
    if ([0, 6, 14].includes(pixels)) return pixels as LookRadius;
    custom[path] = value ?? `${pixels}px`;
    return [0, 6, 14, 22].reduce((best, candidate) => Math.abs(candidate - pixels) < Math.abs(best - pixels) ? candidate : best) as LookRadius;
  };
  const weight = (value: string | undefined, path: LookValuePath): LookWeight => {
    const number = numeric(value, 400);
    if (![600, 700, 800].includes(number)) custom[path] = String(number);
    return number < 650 ? 600 : number < 750 ? 700 : 800;
  };
  look.whole = { bg: color(root, "background", "whole.bg", rootColor), border: color(root, "border-color", "whole.border", rootColor),
    text: color(root, "color", "whole.text", "#000"), radius: radius(root["border-radius"], "whole.radius", 64), align: root["text-align"] as LookAlign };
  const inherited = { ...root, color: rootColor };
  const heading = elementValues(rules, component.type === "choice" ? "prompt" : component.type === "form" ? "heading" : "title", inherited);
  look.heading = { color: color(heading, "color", "heading.color"), size: size(heading["font-size"], LOOK_SIZES.heading, "heading.size"), align: heading["text-align"] as LookAlign };
  const fields = structure.type === "form" ? structure.fields : [];
  const bodyValues = fields.length ? fields.map(field => elementValues(rules, "field", inherited, field.name, field.kind))
    : [elementValues(rules, component.type === "tooltip" ? "text" : "body", inherited)];
  const body = bodyValues[0];
  look.body = { color: color(body, "color", "body.color"), size: size(body["font-size"], LOOK_SIZES.body, "body.size"),
    weight: weight(body["font-weight"], "body.weight"), align: body["text-align"] as LookAlign };
  for (const [property, path] of [["color", "body.color"], ["font-size", "body.size"], ["font-weight", "body.weight"], ["text-align", "body.align"]] as const)
    if (bodyValues.some(value => value[property] !== body[property])) custom[path] = "Mixed";
  const ids = controlIds(component);
  look.btns = look.btns.map((button, index) => {
    const values = elementValues(rules, component.type === "choice" ? "option" : component.type === "form" ? "submit" : "button", inherited, ids[index]);
    const selectedSize = size(values["font-size"], LOOK_SIZES.button, `btns.${index}.size`);
    return { ...button, fill: color(values, "background", `btns.${index}.fill`), text: color(values, "color", `btns.${index}.text`),
      border: color(values, "border-color", `btns.${index}.border`), size: selectedSize,
      weight: weight(values["font-weight"], `btns.${index}.weight`), radius: radius(values["border-radius"], `btns.${index}.radius`, LOOK_SIZES.height[selectedSize] / 2) };
  });
  return { look, custom };
}
