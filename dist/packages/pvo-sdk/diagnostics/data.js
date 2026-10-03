const PRIVATE_KEY = /password|passwd|secret|token|authorization|cookie|credential|email|phone|api[_-]?key|(?:^|[._-])(?:form|name|address|contact|ssn)(?:$|[._-])/i;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 20;
const MAX_NODES = 160;

/** Inspection keeps numeric state useful without retaining private text or unbounded responses. */
export function sanitizeDiagnosticValue(value, path = "") {
  if (typeof path !== "string") return "[unavailable]";
  let remaining = MAX_NODES;
  const seen = new WeakSet();
  function visit(current, key, depth) {
    if (--remaining < 0 || depth > MAX_DEPTH) return "[limited]";
    if (PRIVATE_KEY.test(key)) return "[private]";
    if (current == null) return current === null ? null : "[unset]";
    if (typeof current === "number") return Number.isFinite(current) ? current : "[non-finite]";
    if (typeof current === "boolean") return current;
    if (typeof current === "string") return "[private]";
    if (typeof current !== "object") return "[unavailable]";
    if (seen.has(current)) return "[circular]";
    seen.add(current);
    if (Array.isArray(current)) {
      const length = Object.getOwnPropertyDescriptor(current, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0) return "[unavailable]";
      const result = [];
      for (let index = 0; index < Math.min(length, MAX_ENTRIES); index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        result.push(!descriptor ? "[unset]" : Object.hasOwn(descriptor, "value")
          ? visit(descriptor.value, key, depth + 1) : "[unavailable]");
      }
      if (length > MAX_ENTRIES) result.push("[limited]");
      return result;
    }
    const result = {};
    const keys = Object.keys(current);
    for (const child of keys.slice(0, MAX_ENTRIES)) {
      if (!/^[\w.-]{1,80}$/.test(child) || ["__proto__", "constructor", "prototype"].includes(child)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(current, child);
      result[child] = descriptor && Object.hasOwn(descriptor, "value")
        ? visit(descriptor.value, `${key}.${child}`, depth + 1)
        : "[unavailable]";
    }
    if (keys.length > MAX_ENTRIES) result["…"] = "[limited]";
    return result;
  }
  try { return visit(value, path, 0); }
  catch { return "[unavailable]"; }
}

/** Snapshot a write-path for inspection without invoking state accessors. */
export function snapshotDiagnosticPath(source, path) {
  if (typeof path !== "string") return "[unavailable]";
  try {
    let current = source;
    for (const key of path.split(".").filter(Boolean)) {
      if (current == null) return "[unset]";
      const descriptor = Object.getOwnPropertyDescriptor(Object(current), key);
      if (!descriptor) return "[unset]";
      if (!Object.hasOwn(descriptor, "value")) return "[unavailable]";
      current = descriptor.value;
    }
    return sanitizeDiagnosticValue(current, path);
  } catch { return "[unavailable]"; }
}

/** Keep the destination evidence; discard credentials, queries, fragments and secret-like segments. */
export function sanitizeDiagnosticUrl(value) {
  if (typeof value !== "string") return "[invalid URL]";
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "[invalid URL]";
    let previousPrivate = false;
    const path = url.pathname.split("/").map(segment => {
      let decoded;
      try { decoded = decodeURIComponent(segment); } catch { decoded = segment; }
      const hidden = previousPrivate || decoded.includes("@") || /[A-Za-z0-9_-]{40,}/.test(decoded);
      previousPrivate = PRIVATE_KEY.test(decoded) || /^(?:users?|accounts?|members?|profiles?|auth|session)$/i.test(decoded);
      return hidden ? "[private]" : segment.slice(0, 80);
    }).join("/");
    return `${url.origin}${path}`.slice(0, 300);
  } catch { return "[invalid URL]"; }
}

/** Bounded display-only error text. Never use this to retain request/response bodies. */
export function sanitizeDiagnosticText(value) {
  if (value != null && !["string", "number", "boolean", "bigint", "symbol"].includes(typeof value))
    return "Diagnostic unavailable.";
  try {
    return String(value ?? "")
      .replace(/https?:\/\/[^\s<>"']+/gi, sanitizeDiagnosticUrl)
      .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, "[private]")
      .replace(/\b(?:authorization|cookie|password|secret|(?:access[_-]?|refresh[_-]?|auth[_-]?)?token|api[_-]?key)\s*[:=]\s*[^\n,;]+/gi, "[private]")
      .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[private]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 300);
  } catch { return "Diagnostic unavailable."; }
}

/** Observation must never be able to reject an action or interrupt playback. */
export function observeDiagnostic(observer, event) {
  if (typeof observer !== "function") return;
  try {
    const result = observer(event);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch { /* Diagnostics are optional; failures cannot enter the execution path. */ }
}
