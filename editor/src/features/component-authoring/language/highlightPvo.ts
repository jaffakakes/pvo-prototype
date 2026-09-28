export type PvoLanguagePart = "structure" | "style" | "logic";

export type PvoTokenKind =
  | "plain" | "tag" | "attribute" | "string" | "keyword" | "function"
  | "number" | "property" | "selector" | "punctuation" | "template";

export type PvoToken = { kind: PvoTokenKind; text: string };

type TokenWriter = (kind: PvoTokenKind, text: string) => void;

/** Read a draft string without decoding it. Structure quotes have no backslash escape. */
function quotedEnd(source: string, start: number, escapes: boolean): number {
  const quote = source[start];
  let end = start + 1;
  while (end < source.length) {
    if (escapes && source[end] === "\\") end = Math.min(end + 2, source.length);
    else if (source[end++] === quote) break;
  }
  return end;
}

function structureTemplate(source: string): string | undefined {
  // Entities and Field placeholders remain literal source, including unfinished drafts.
  return /^(?:\{\{[^{}<>"'\r\n]*(?:\}\}|$)|&(?:#[xX][\da-fA-F]*|#\d*|[A-Za-z][A-Za-z0-9]*);?)/.exec(source)?.[0];
}

function writeStructureValue(value: string, write: TokenWriter): void {
  let cursor = 0;
  while (cursor < value.length) {
    const template = structureTemplate(value.slice(cursor));
    if (template) {
      write("template", template);
      cursor += template.length;
    } else {
      const next = /[&{]/g;
      next.lastIndex = cursor + 1;
      const end = next.exec(value)?.index ?? value.length;
      write("string", value.slice(cursor, end));
      cursor = end;
    }
  }
}

function tokenizeStructure(source: string, write: TokenWriter): void {
  let cursor = 0;
  let inTag = false;
  let needsTagName = false;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    let kind: PvoTokenKind = "plain";
    let text: string | undefined;
    const template = structureTemplate(rest);
    if (template) {
      kind = "template";
      text = template;
    } else if (!inTag && /^<\/?(?:[A-Za-z]|$)/.test(rest)) {
      text = rest.startsWith("</") ? "</" : "<";
      kind = "punctuation";
      inTag = true;
      needsTagName = true;
    } else if (inTag) {
      if (rest.startsWith("/>") || rest[0] === ">") {
        text = rest.startsWith("/>") ? "/>" : ">";
        kind = "punctuation";
        inTag = false;
      } else if (rest[0] === '"' || rest[0] === "'") {
        const end = quotedEnd(source, cursor, false);
        writeStructureValue(source.slice(cursor, end), write);
        cursor = end;
        continue;
      } else if ((text = /^[A-Za-z][A-Za-z0-9_-]*/.exec(rest)?.[0])) {
        kind = needsTagName ? "tag" : "attribute";
        needsTagName = false;
      } else if (rest[0] === "=") {
        kind = "punctuation";
        text = "=";
      } else text = /^\s+/.exec(rest)?.[0];
    } else text = /^[^<&{]+/.exec(rest)?.[0];
    text ??= String.fromCodePoint(source.codePointAt(cursor)!);
    write(kind, text);
    cursor += text.length;
  }
}

function tokenizeStyle(source: string, write: TokenWriter): void {
  let cursor = 0;
  let inRule = false;
  let expectsProperty = false;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    let kind: PvoTokenKind = "plain";
    let text = /^\s+/.exec(rest)?.[0];
    if (!text && (rest[0] === '"' || rest[0] === "'")) {
      text = source.slice(cursor, quotedEnd(source, cursor, true));
      kind = "string";
    } else if (!text && /[{}:;,()[\]]/.test(rest[0])) {
      text = rest[0];
      kind = "punctuation";
      if (text === "{") { inRule = true; expectsProperty = true; }
      else if (text === "}") { inRule = false; expectsProperty = false; }
      else if (inRule && text === ";") expectsProperty = true;
      else if (inRule && text === ":") expectsProperty = false;
    } else if (!text && !inRule && (text = /^#?[A-Za-z_][A-Za-z0-9_-]*|^#/.exec(rest)?.[0])) {
      kind = "selector";
    } else if (!text && inRule && !expectsProperty && (text = /^(?:#[\da-fA-F]+|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?(?:[A-Za-z]+|%)?)/.exec(rest)?.[0])) {
      kind = "number";
    } else if (!text && (text = /^-?[A-Za-z_][A-Za-z0-9_-]*/.exec(rest)?.[0])) {
      kind = expectsProperty ? "property" : /^\s*\(/.test(rest.slice(text.length)) ? "function" : "keyword";
    }
    text ??= String.fromCodePoint(source.codePointAt(cursor)!);
    write(kind, text);
    cursor += text.length;
  }
}

function tokenizeLogic(source: string, write: TokenWriter): void {
  const keywords = new Set(["on", "press", "choose", "submit", "true", "false", "null"]);
  const actions = new Set(["continue", "jump_to", "go_to_scene", "request"]);
  let cursor = 0;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    let kind: PvoTokenKind = "plain";
    let text = /^\s+/.exec(rest)?.[0];
    if (!text && (rest[0] === '"' || rest[0] === "'")) {
      const end = quotedEnd(source, cursor, true);
      text = source.slice(cursor, end);
      kind = /^\s*:/.test(source.slice(end)) ? "property" : "string";
    } else if (!text && (text = /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/.exec(rest)?.[0])) {
      kind = "number";
    } else if (!text && (text = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest)?.[0])) {
      if (keywords.has(text)) kind = "keyword";
      else if (actions.has(text) || /^\s*\(/.test(rest.slice(text.length))) kind = "function";
    } else if (!text && /[{}()[\]:;,]/.test(rest[0])) {
      text = rest[0];
      kind = "punctuation";
    }
    text ??= String.fromCodePoint(source.codePointAt(cursor)!);
    write(kind, text);
    cursor += text.length;
  }
}

/** Visual-only, tolerant tokens. Render `text` as text nodes; the Rust compiler validates. */
export function tokenizePvo(source: string, part: PvoLanguagePart): PvoToken[] {
  const tokens: PvoToken[] = [];
  const write: TokenWriter = (kind, text) => {
    if (!text) return;
    const previous = tokens.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else tokens.push({ kind, text });
  };
  if (part === "structure") tokenizeStructure(source, write);
  else if (part === "style") tokenizeStyle(source, write);
  else tokenizeLogic(source, write);
  return tokens;
}
