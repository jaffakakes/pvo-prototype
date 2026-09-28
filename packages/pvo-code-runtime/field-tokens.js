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

export function substituteFieldTokens(html, fields = {}) {
  return String(html).replace(
    /\{\{\s*([A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*)\s*\}\}/g,
    (_, path) => escapeHtml(tokenValue(fields, path)),
  );
}
