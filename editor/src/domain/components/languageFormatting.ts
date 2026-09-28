import type { PvoLanguageSource } from "./languageSource";
import { formatLogic } from "./languageLogicFormatting";
import { validStyleValue, type StyleProperty } from "./languageLookStyle";

// Match Rust's Structure/Style whitespace, including U+0085 but excluding BOM.
const SPACE = "[\\u0009-\\u000d \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const leadingSpace = new RegExp(`^${SPACE}*`, "u");
const trailingSpace = new RegExp(`${SPACE}*$`, "u");
const tagName = /^[A-Za-z][A-Za-z0-9_-]*/;
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const forbiddenNames = new Set(["constructor", "prototype", "__proto__"]);
const entities = /&(?!(?:amp|lt|gt|quot|apos|#39|#x27|#X27);)/;
const children: Record<string, readonly string[]> = {
  tooltip: ["text"], card: ["title", "body", "button"],
  choice: ["prompt", "option"], form: ["heading", "field", "submit"],
};

function trimSpace(value: string): string {
  return value.replace(leadingSpace, "").replace(trailingSpace, "");
}

type Opening = { raw: string; name: string; attributes: Map<string, string>; selfClosing: boolean; end: number };

function opening(source: string, start: number): Opening | null {
  if (source[start] !== "<") return null;
  const name = tagName.exec(source.slice(start + 1))?.[0];
  if (!name) return null;
  let cursor = start + 1 + name.length;
  const attributes = new Map<string, string>();
  while (cursor < source.length) {
    cursor += leadingSpace.exec(source.slice(cursor))![0].length;
    const selfClosing = source.startsWith("/>", cursor);
    if (selfClosing || source[cursor] === ">") {
      const end = cursor + (selfClosing ? 2 : 1);
      return { raw: source.slice(start, end), name, attributes, selfClosing, end };
    }
    const attribute = tagName.exec(source.slice(cursor))?.[0];
    if (!attribute || attributes.has(attribute)) return null;
    cursor += attribute.length;
    cursor += leadingSpace.exec(source.slice(cursor))![0].length;
    if (source[cursor++] !== "=") return null;
    cursor += leadingSpace.exec(source.slice(cursor))![0].length;
    const quote = source[cursor++];
    if (quote !== '"' && quote !== "'") return null;
    const end = source.indexOf(quote, cursor);
    if (end < 0) return null;
    const value = source.slice(cursor, end);
    if (value.includes("<") || entities.test(value)) return null;
    attributes.set(attribute, value);
    cursor = end + 1;
  }
  return null;
}

function closing(source: string, name: string): string | undefined {
  return new RegExp(`^</${name}${SPACE}*>`, "u").exec(source)?.[0];
}

function validAttributes(tag: Opening, ids: Set<string>): boolean {
  const allowed = tag.name === "field" ? ["name", "kind", "label"]
    : tag.name === "button" || tag.name === "option" ? ["id"] : tag.name === "submit" ? ["waiting"] : [];
  if ([...tag.attributes.keys()].some(name => !allowed.includes(name))) return false;
  if (tag.name === "field" || tag.name === "button" || tag.name === "option") {
    const id = tag.attributes.get(tag.name === "field" ? "name" : "id");
    if (!id || !identifier.test(id) || forbiddenNames.has(id) || ids.has(id)) return false;
    ids.add(id);
  }
  if (tag.name === "field" && !["name", "email", "phone", "short", "number", "yesno"].includes(tag.attributes.get("kind") ?? "")) return false;
  return ["label", "waiting"].every(name => !tag.attributes.has(name) || trimSpace(tag.attributes.get(name)!) !== "");
}

function formatStructure(source: string): string | null {
  let cursor = leadingSpace.exec(source)![0].length;
  const root = opening(source, cursor);
  if (!root || root.selfClosing || root.attributes.size || !Object.hasOwn(children, root.name)) return null;
  cursor = root.end;
  const lines = [root.raw];
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  while (cursor < source.length) {
    cursor += leadingSpace.exec(source.slice(cursor))![0].length;
    const end = closing(source.slice(cursor), root.name);
    if (end) {
      if (trimSpace(source.slice(cursor + end.length))) return null;
      const count = (name: string) => counts.get(name) ?? 0;
      const complete = root.name === "tooltip" ? count("text") === 1
        : root.name === "card" ? count("title") + count("body") > 0 && count("button") <= 2
          : root.name === "choice" ? count("prompt") === 1 && count("option") >= 2 && count("option") <= 4
            : count("field") >= 1 && count("field") <= 20 && count("submit") === 1;
      return complete ? [...lines, end].join("\n") : null;
    }
    const child = opening(source, cursor);
    if (!child || !children[root.name].includes(child.name) || !validAttributes(child, ids)) return null;
    const count = (counts.get(child.name) ?? 0) + 1;
    if (!["button", "option", "field"].includes(child.name) && count > 1) return null;
    counts.set(child.name, count);
    if (child.name === "field") {
      if (!child.selfClosing) return null;
      cursor = child.end;
    } else {
      if (child.selfClosing) return null;
      const textEnd = source.indexOf("<", child.end);
      if (textEnd < 0) return null;
      const text = source.slice(child.end, textEnd);
      const childEnd = closing(source.slice(textEnd), child.name);
      if (!childEnd || !trimSpace(text) || entities.test(text)) return null;
      cursor = textEnd + childEnd.length;
    }
    // Keep leaf wording and attribute literals intact, including their own line breaks.
    lines.push(`  ${source.slice(child.end - child.raw.length, cursor)}`);
  }
  return null;
}

function formatStyle(source: string): string | null {
  let remaining = source;
  const rules: string[] = [];
  let declarations = 0;
  const selector = new RegExp(`^(#[A-Za-z][A-Za-z0-9_-]*|[A-Za-z]+)${SPACE}*\\{`, "u");
  const property = new RegExp(`^([a-z-]+)${SPACE}*:${SPACE}*([^;{}]+);`, "u");
  const tags = new Set([...Object.keys(children), ...Object.values(children).flat()]);
  while (trimSpace(remaining)) {
    remaining = remaining.replace(leadingSpace, "");
    const start = selector.exec(remaining);
    if (!start || (!start[1].startsWith("#") && !tags.has(start[1])) || rules.length >= 64) return null;
    remaining = remaining.slice(start[0].length);
    const lines: string[] = [];
    while (true) {
      remaining = remaining.replace(leadingSpace, "");
      if (remaining.startsWith("}")) { remaining = remaining.slice(1); break; }
      const declaration = property.exec(remaining);
      if (!declaration || ++declarations > 256) return null;
      const name = declaration[1] === "background-color" ? "background" : declaration[1];
      if (!["background", "color", "border-color", "border-radius", "font-size", "font-weight", "text-align"].includes(name)) return null;
      const value = trimSpace(declaration[2]);
      if (!validStyleValue(name as StyleProperty, value)) return null;
      lines.push(`  ${declaration[1]}: ${value};`);
      remaining = remaining.slice(declaration[0].length);
    }
    if (!lines.length) return null;
    rules.push(`${start[1]} {\n${lines.join("\n")}\n}`);
  }
  return rules.join("\n\n");
}

/** Whitespace-only authoring layout. The compiler still owns semantic validation. */
export function formatPvoPart(part: keyof PvoLanguageSource, value: string): string {
  if (new TextEncoder().encode(value).byteLength > 20000) return value;
  const formatted = part === "structure" ? formatStructure(value) : part === "style" ? formatStyle(value) : formatLogic(value);
  return formatted !== null && new TextEncoder().encode(formatted).byteLength <= 20000 ? formatted : value;
}

export function formatPvoSource(source: PvoLanguageSource): PvoLanguageSource {
  return {
    structure: formatPvoPart("structure", source.structure),
    style: formatPvoPart("style", source.style),
    logic: formatPvoPart("logic", source.logic),
  };
}
