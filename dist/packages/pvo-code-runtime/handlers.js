import { METHODS } from "./policy.js";

export function parseHandler(source) {
  const match =
    /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\((.*)\)\s*;?\s*$/s.exec(
      source,
    );
  if (!match)
    throw new Error(
      "Handlers must call one function, for example pvo.pick(0) or onPick('street').",
    );
  const name = match[1];
  if (
    name.includes(".") &&
    (!name.startsWith("pvo.") || !METHODS.has(name.slice(4)))
  )
    throw new Error("Only pvo.* bridge calls are allowed in markup.");
  const sourceArgs = match[2].trim();
  if (!sourceArgs) return { name, args: [] };
  const parts = [];
  let start = 0,
    quote = "",
    escaped = false;
  for (let i = 0; i < sourceArgs.length; i++) {
    const ch = sourceArgs[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ",") {
      parts.push(sourceArgs.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote) throw new Error("Unclosed string in component handler.");
  parts.push(sourceArgs.slice(start).trim());
  if (parts.length > 8)
    throw new Error("Too many component handler arguments.");
  const args = parts.map((part) => {
    if (part === "fields") return { __pvoFormFields: true };
    if (part === "true") return true;
    if (part === "false") return false;
    if (part === "null") return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(part)) return Number(part);
    if (/^"(?:[^"\\]|\\.)*"$/.test(part)) return JSON.parse(part);
    if (/^'(?:[^'\\]|\\.)*'$/.test(part))
      return part.slice(1, -1).replace(/\\(['\\])/g, "$1");
    throw new Error(
      "Component handlers accept only literal arguments or fields.",
    );
  });
  return { name, args };
}
