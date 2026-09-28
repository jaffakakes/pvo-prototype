export function readPath(source, path) {
  if (!path) return source;
  const parts = path.startsWith("/")
    ? path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    : path.split(".");
  return parts.filter(Boolean).reduce((value, key) => {
    if (UNSAFE_STATE_KEYS.has(key) || value == null || !Object.hasOwn(Object(value), key)) return undefined;
    return value[key];
  }, source);
}

const UNSAFE_STATE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function writePath(target, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  if (!parts.length) return;
  if (parts.some((part) => UNSAFE_STATE_KEYS.has(part))) {
    throw new Error("State path contains a reserved key.");
  }
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!Object.hasOwn(cursor, part) || !cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}
