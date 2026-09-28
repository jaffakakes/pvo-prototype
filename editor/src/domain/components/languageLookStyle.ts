import type { PvoLanguageStructure } from "../../../../packages/pvo-language/index.js";

export type StyleProperty = "background" | "color" | "border-color" | "border-radius" | "font-size" | "font-weight" | "text-align";
export type StyleValues = Partial<Record<StyleProperty, string>>;
type Declaration = { property: StyleProperty; value: string; start: number; end: number };
export type StyleRule = { selector: string; declarations: Declaration[]; start: number; end: number };
export type StyleChange = { selector: string; property: StyleProperty; value: string };

const TAGS = {
  tooltip: ["tooltip", "text"], card: ["card", "title", "body", "button"],
  choice: ["choice", "prompt", "option"], form: ["form", "heading", "field", "submit"],
};
// Rust char::is_whitespace includes U+0085 and excludes the JavaScript BOM.
const SPACE = "[\\u0009-\\u000d \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const whitespaceCharacter = new RegExp(SPACE, "u");
const openingRule = new RegExp(`^([#A-Za-z_][\\w-]*)${SPACE}*\\{`, "u");
const declarationRule = new RegExp(`^([a-z-]+)${SPACE}*:${SPACE}*([^;{}]+);`, "u");
const trimmedWhitespace = new RegExp(`^${SPACE}+|${SPACE}+$`, "gu");

export function structureIds(structure: PvoLanguageStructure): string[] {
  if (structure.type === "card") return structure.buttons.map(button => button.id);
  if (structure.type === "choice") return structure.options.map(option => option.id);
  if (structure.type === "form") return structure.fields.map(field => field.name);
  return [];
}

function validColor(value: string): boolean {
  if (/^#[\da-f]{3,4}$/i.test(value) || /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)
    || value === "transparent" || value === "currentColor") return true;
  const color = /^(rgb|rgba)\(([^()]+)\)$/.exec(value);
  if (!color) return false;
  const parts = color[2].split(",").map(part => part.replace(trimmedWhitespace, ""));
  return parts.length === (color[1] === "rgba" ? 4 : 3)
    && parts.slice(0, 3).every(part => /^\d+$/.test(part) && Number(part) <= 255)
    && (parts.length === 3 || (/^[\d.]{1,6}$/.test(parts[3]) && Number.isFinite(Number(parts[3])) && Number(parts[3]) >= 0 && Number(parts[3]) <= 1));
}

export function validStyleValue(property: StyleProperty, value: string): boolean {
  if (["background", "color", "border-color"].includes(property)) return validColor(value);
  if (property === "font-weight") return /^(400|500|600|700|800|900)$/.test(value);
  if (property === "text-align") return /^(left|center|right)$/.test(value);
  if (property === "border-radius" && value === "0") return true;
  const pixels = /^([\d.]{1,8})px$/.exec(value);
  return Boolean(pixels && Number.isFinite(Number(pixels[1])) && Number(pixels[1]) >= (property === "font-size" ? 8 : 0)
    && Number(pixels[1]) <= (property === "font-size" ? 72 : 64));
}

/** Read the flat visual subset, retaining source ranges for property-only edits.
 * Rust remains the full compiler; these checks also keep untrusted saved drafts
 * from becoming styles on the editor's own colour controls before compilation.
 */
export function readLookStyle(source: string, structure: PvoLanguageStructure): StyleRule[] | null {
  if (new TextEncoder().encode(source).byteLength > 20000) return null;
  const selectors = new Set([...TAGS[structure.type], ...structureIds(structure).map(id => `#${id}`)]);
  const rules: StyleRule[] = [];
  let cursor = 0;
  let count = 0;
  const whitespace = () => { while (cursor < source.length && whitespaceCharacter.test(source[cursor])) cursor++; };
  while (cursor < source.length) {
    whitespace();
    if (cursor === source.length) break;
    const start = cursor;
    const opening = openingRule.exec(source.slice(cursor));
    if (!opening || !selectors.has(opening[1]) || rules.length >= 64) return null;
    cursor += opening[0].length;
    const declarations: Declaration[] = [];
    while (true) {
      whitespace();
      if (source[cursor] === "}") { cursor++; break; }
      const declarationStart = cursor;
      const declaration = declarationRule.exec(source.slice(cursor));
      if (!declaration || ++count > 256) return null;
      const property = declaration[1] === "background-color" ? "background" : declaration[1];
      if (!["background", "color", "border-color", "border-radius", "font-size", "font-weight", "text-align"].includes(property)) return null;
      const typed = property as StyleProperty;
      const value = declaration[2].replace(trimmedWhitespace, "");
      if (!validStyleValue(typed, value)) return null;
      cursor += declaration[0].length;
      declarations.push({ property: typed, value, start: declarationStart, end: cursor });
    }
    if (!declarations.length) return null;
    rules.push({ selector: opening[1], declarations, start, end: cursor });
  }
  return rules;
}

/** PVO lowers tags and local IDs to equal-specificity class/attribute selectors. */
export function effectiveStyle(rules: readonly StyleRule[], tag: string, id?: string): StyleValues {
  const values: StyleValues = {};
  for (const rule of rules) {
    if (rule.selector !== tag && rule.selector !== `#${id}`) continue;
    for (const declaration of rule.declarations) values[declaration.property] = declaration.value;
  }
  return values;
}

/** Remove only replaced declarations, then place their overrides after all authored rules. */
export function patchLookStyle(source: string, rules: readonly StyleRule[], changes: readonly StyleChange[]): string {
  const keys = new Set(changes.map(change => `${change.selector}:${change.property}`));
  const removals: { start: number; end: number }[] = [];
  for (const rule of rules) {
    const removed = rule.declarations.filter(item => keys.has(`${rule.selector}:${item.property}`));
    if (removed.length === rule.declarations.length) removals.push(rule);
    else removals.push(...removed);
  }
  let output = source;
  for (const range of removals.sort((left, right) => right.start - left.start))
    output = output.slice(0, range.start) + output.slice(range.end);
  const blocks = new Map<string, StyleChange[]>();
  for (const change of changes) blocks.set(change.selector, [...(blocks.get(change.selector) ?? []), change]);
  const additions = [...blocks].map(([selector, values]) =>
    `${selector} {\n${values.map(value => `  ${value.property}: ${value.value};`).join("\n")}\n}`).join("\n\n");
  return `${output.trimEnd()}${output.trim() ? "\n\n" : ""}${additions}`;
}
