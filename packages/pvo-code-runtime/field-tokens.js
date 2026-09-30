const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const UNSAFE_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function tokenValue(fields, path) {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let value = fields;
  for (const segment of segments) {
    if (
      !/^(?:[A-Za-z_$][\w$]*|\d+)$/.test(segment) ||
      segment === "__proto__" ||
      segment === "constructor" ||
      segment === "prototype"
    )
      return "";
    if (
      value == null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, segment)
    )
      return "";
    value = value[segment];
  }
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : "";
}

function stateTokenValue(state, path) {
  const segments = path.startsWith("/")
    ? path
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    : path.split(".");
  let value = state;
  for (const segment of segments.filter(Boolean)) {
    if (
      UNSAFE_PATH_SEGMENTS.has(segment) ||
      value == null ||
      !Object.hasOwn(Object(value), segment)
    )
      return "";
    value = value[segment];
  }
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : "";
}

const RUNTIME_TOKEN =
  /\{\{\s*([A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*)\s*\}\}|\{state\.([^{}]+)\}/g;

/** Resolve field and runtime-state tokens once, escaping every inserted scalar. */
export function substituteRuntimeTokens(html, fields = {}, state) {
  const source = String(html);
  return source.replace(RUNTIME_TOKEN, (match, fieldPath, statePath) => {
    if (fieldPath !== undefined) return escapeHtml(tokenValue(fields, fieldPath));
    if (state === undefined) return match;
    return escapeHtml(stateTokenValue(state, statePath));
  });
}

export function substituteFieldTokens(html, fields = {}) {
  return substituteRuntimeTokens(html, fields);
}
