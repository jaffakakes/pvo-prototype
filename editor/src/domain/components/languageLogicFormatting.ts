const stringToken = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/;
const numberToken = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const indent = (depth: number) => "  ".repeat(depth);

type JsonResult = { source: string; end: number };

/** Read JSON tokens, never decoded values: rounding and string escape changes are forbidden. */
function jsonValue(source: string, start: number, depth: number): JsonResult | null {
  if (depth > 32) return null;
  let cursor = start;
  const skipSpace = () => { while (/[\t\n\r ]/.test(source[cursor] ?? "!")) cursor++; };
  skipSpace();
  const primitive = stringToken.exec(source.slice(cursor))?.[0]
    ?? numberToken.exec(source.slice(cursor))?.[0]
    ?? /^(?:true|false|null)/.exec(source.slice(cursor))?.[0];
  if (primitive) return { source: primitive, end: cursor + primitive.length };
  const open = source[cursor++];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  skipSpace();
  if (source[cursor] === close) return { source: open + close, end: cursor + 1 };
  const entries: string[] = [];
  while (cursor < source.length) {
    let key = "";
    if (open === "{") {
      const literal = stringToken.exec(source.slice(cursor))?.[0];
      if (!literal) return null;
      cursor += literal.length;
      skipSpace();
      if (source[cursor++] !== ":") return null;
      key = `${literal}: `;
    }
    const value = jsonValue(source, cursor, depth + 1);
    if (!value) return null;
    entries.push(`${indent(depth + 1)}${key}${value.source}`);
    cursor = value.end;
    skipSpace();
    if (source[cursor] === close)
      return { source: `${open}\n${entries.join(",\n")}\n${indent(depth)}${close}`, end: cursor + 1 };
    if (source[cursor++] !== ",") return null;
    skipSpace();
  }
  return null;
}

/** Format only complete approved event/action syntax; unfinished or unknown source is untouched. */
export function formatLogic(source: string): string | null {
  let cursor = 0;
  const rules: string[] = [];
  const seen = new Set<string>();
  const skipSpace = () => { while (/[\t\n\r\f\v ]/.test(source[cursor] ?? "!")) cursor++; };
  const take = (mark: string) => {
    skipSpace();
    if (!source.startsWith(mark, cursor)) return false;
    cursor += mark.length;
    return true;
  };
  const word = () => {
    skipSpace();
    const value = /^[A-Za-z][A-Za-z0-9_-]*/.exec(source.slice(cursor))?.[0];
    if (value) cursor += value.length;
    return value;
  };
  while (true) {
    skipSpace();
    if (cursor === source.length) return rules.join("\n\n");
    if (word() !== "on") return null;
    const event = word();
    if (event !== "press" && event !== "choose" && event !== "submit") return null;
    let eventSource = event;
    if (event !== "submit") {
      if (!take("(")) return null;
      const target = word();
      if (!target || target.length > 64 || ["constructor", "prototype", "__proto__"].includes(target) || !take(")")) return null;
      eventSource += `(${target})`;
    }
    if (seen.has(eventSource) || !take("{")) return null;
    seen.add(eventSource);
    const action = word();
    if (!["continue", "jump_to", "go_to_scene", "request"].includes(action ?? "") || !take("(")) return null;
    skipSpace();
    let argument = "";
    if (action === "jump_to") {
      argument = /^[\d.]+/.exec(source.slice(cursor))?.[0] ?? "";
      if (!argument || !Number.isFinite(Number(argument)) || Number(argument) < 0) return null;
      cursor += argument.length;
    } else if (action === "go_to_scene") {
      argument = stringToken.exec(source.slice(cursor))?.[0] ?? "";
      if (!argument) return null;
      cursor += argument.length;
    } else if (action === "request") {
      if (source[cursor] !== "{") return null;
      const json = jsonValue(source, cursor, 1);
      if (!json || new TextEncoder().encode(source.slice(cursor, json.end)).byteLength > 12000
        || new TextEncoder().encode(json.source).byteLength > 12000) return null;
      argument = json.source;
      cursor = json.end;
    }
    if (!take(")") || !take(";") || !take("}")) return null;
    rules.push(`on ${eventSource} {\n  ${action}(${argument});\n}`);
  }
}
