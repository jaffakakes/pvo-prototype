import { readPath } from "./state-paths.js";

export function evaluateWhen(condition, context = {}) {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.every((item) => evaluateWhen(item, context));
  if (Array.isArray(condition.all)) return condition.all.every((item) => evaluateWhen(item, context));
  if (Array.isArray(condition.any)) return condition.any.some((item) => evaluateWhen(item, context));

  let actual;
  if (condition.key != null) actual = readPath(context.state, condition.key);
  else if (condition.response != null) actual = readPath(context.response, condition.response);
  else if (condition.source === "response") actual = readPath(context.response, condition.path);
  else actual = readPath(context.state, condition.path);

  if (Object.hasOwn(condition, "is")) return actual === condition.is;
  if (Object.hasOwn(condition, "not")) return actual !== condition.not;
  if (Object.hasOwn(condition, "gt")) return Number(actual) > Number(condition.gt);
  if (Object.hasOwn(condition, "gte")) return Number(actual) >= Number(condition.gte);
  if (Object.hasOwn(condition, "lt")) return Number(actual) < Number(condition.lt);
  if (Object.hasOwn(condition, "lte")) return Number(actual) <= Number(condition.lte);
  if (Object.hasOwn(condition, "in")) return Array.isArray(condition.in) && condition.in.includes(actual);
  if (Object.hasOwn(condition, "exists")) return condition.exists ? actual !== undefined && actual !== null : actual == null;
  return Boolean(actual);
}

export function resolveTemplates(value, context = {}) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, context)]));
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\{(state|response)\.([^}]+)\}$/);
  if (exact) return readPath(context[exact[1]], exact[2]);
  return value.replace(/\{(state|response)\.([^}]+)\}/g, (_, source, path) => {
    const resolved = readPath(context[source], path);
    return resolved == null ? "" : String(resolved);
  });
}

/** Resolve display text without leaking object coercions such as "[object Object]". */
export function resolveTextTemplate(value, context = {}) {
  const text = value == null ? "" : String(value);
  const display = (resolved) => {
    if (resolved == null || typeof resolved === "object" || typeof resolved === "function") return "";
    return String(resolved);
  };
  const exact = text.match(/^\{(state|response)\.([^}]+)\}$/);
  if (exact) return display(readPath(context[exact[1]], exact[2]));
  return text.replace(/\{(state|response)\.([^}]+)\}/g, (_, source, path) => display(readPath(context[source], path)));
}
