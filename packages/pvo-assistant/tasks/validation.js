import { TASK_LIMITS } from "./limits.js";

export function requireTask(condition, message) {
  if (!condition) throw new Error(message);
}

export function object(value, keys, path) {
  requireTask(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    `${path} must be a plain object.`,
  );
  const own = Reflect.ownKeys(value);
  requireTask(
    own.length === keys.length && keys.every((key) => own.includes(key)),
    `${path} has missing or unsupported fields.`,
  );
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireTask(
      descriptor.enumerable && "value" in descriptor,
      `${path} must contain JSON values.`,
    );
  }
  return value;
}

export function list(value, maximum, path) {
  requireTask(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= maximum,
    `${path} exceeds its item limit or is not an array.`,
  );
  requireTask(
    Reflect.ownKeys(value).length === value.length + 1,
    `${path} must be a JSON array.`,
  );
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireTask(
      descriptor?.enumerable && "value" in descriptor,
      `${path} must contain JSON values.`,
    );
  }
  return value;
}

export function text(value, maximum, path, allowEmpty = false) {
  requireTask(typeof value === "string", `${path} must be text.`);
  requireTask(
    (allowEmpty || value.trim().length > 0) &&
      new TextEncoder().encode(value).length <= maximum,
    `${path} is empty or exceeds its byte limit.`,
  );
}

export function id(value, path) {
  text(value, TASK_LIMITS.idBytes, path);
  requireTask(
    /^[A-Za-z0-9_-]+$/.test(value),
    `${path} must be an opaque identifier.`,
  );
}

export function digest(value, path) {
  requireTask(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    `${path} must be a SHA-256 digest.`,
  );
}

export function integer(value, maximum, path, minimum = 0) {
  requireTask(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${path} is outside its range.`,
  );
}

export function time(value, path) {
  integer(value, 8_640_000_000_000_000, path);
}

export function choice(value, values, path) {
  requireTask(values.includes(value), `${path} is unsupported.`);
}

export function unique(values, path) {
  requireTask(
    new Set(values).size === values.length,
    `${path} must be unique.`,
  );
}

export function boundedJson(value, maximum, path) {
  requireTask(
    new TextEncoder().encode(JSON.stringify(value)).length <= maximum,
    `${path} exceeds its total byte limit.`,
  );
}
