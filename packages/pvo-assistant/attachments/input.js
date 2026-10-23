import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { boundedValue, serviceName } from "../services/values.js";
import {
  boundedJson,
  list,
  object,
  requireTask,
  unique,
} from "../tasks/validation.js";

/** Explicit data bindings, never executable expressions or text interpolation. */
export function validateAttachmentInput(
  value,
  schema,
  budget = { nodes: 0 },
  depth = 0,
) {
  requireTask(
    ++budget.nodes <= SERVICE_PACKAGE_LIMITS.schemaNodes &&
      depth <= SERVICE_PACKAGE_LIMITS.schemaDepth,
    "Service input binding exceeds its size or depth limit.",
  );
  const kind = value && Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "literal") {
    object(value, ["kind", "value"], "Literal input binding");
    if (schema)
      boundedValue(
        schema,
        value.value,
        SERVICE_PACKAGE_LIMITS.inputBytes,
        "Service input literal",
      );
    else validateJson(value.value, budget, depth + 1);
  } else if (kind === "field") {
    object(value, ["kind", "name"], "Form input binding");
    serviceName(value.name, "Form field name");
    requireTask(
      !schema ||
        ["string", "enum", "number", "integer", "boolean"].includes(
          schema.type,
        ),
      "A form field must bind a scalar service input.",
    );
  } else if (kind === "object") {
    object(value, ["kind", "fields"], "Object input binding");
    list(value.fields, SERVICE_PACKAGE_LIMITS.fields, "Input binding fields");
    requireTask(
      !schema || schema.type === "object",
      "Input binding must match the service data description.",
    );
    for (const field of value.fields) {
      object(field, ["name", "value"], "Input binding field");
      serviceName(field.name, "Input binding field name");
      const target = schema?.fields.find((item) => item.name === field.name);
      requireTask(!schema || target, "Unknown service input field.");
      validateAttachmentInput(field.value, target?.schema, budget, depth + 1);
    }
    unique(
      value.fields.map((field) => field.name),
      "Input binding field names",
    );
    requireTask(
      !schema || value.fields.length === schema.fields.length,
      "Every service input field needs a binding.",
    );
  } else if (kind === "array") {
    object(value, ["kind", "items"], "Array input binding");
    requireTask(
      !schema || schema.type === "array",
      "Input binding must match the service data description.",
    );
    list(
      value.items,
      schema?.maxItems ?? SERVICE_PACKAGE_LIMITS.arrayItems,
      "Input binding items",
    );
    for (const item of value.items)
      validateAttachmentInput(item, schema?.items, budget, depth + 1);
  } else throw new Error("Unsupported service input binding.");
  if (depth === 0)
    boundedJson(
      value,
      SERVICE_PACKAGE_LIMITS.inputBytes,
      "Service input binding",
    );
}

function validateJson(value, budget, depth) {
  requireTask(
    ++budget.nodes <= SERVICE_PACKAGE_LIMITS.schemaNodes &&
      depth <= SERVICE_PACKAGE_LIMITS.schemaDepth,
    "Service input literal exceeds its size or depth limit.",
  );
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return;
  if (typeof value === "number") {
    requireTask(
      Number.isFinite(value),
      "Service input numbers must be finite.",
    );
    return;
  }
  if (Array.isArray(value)) {
    list(value, SERVICE_PACKAGE_LIMITS.arrayItems, "Service input array");
    for (const item of value) validateJson(item, budget, depth + 1);
    return;
  }
  requireTask(
    value && typeof value === "object",
    "Service input literals must contain JSON data.",
  );
  const keys = Object.keys(value);
  requireTask(
    keys.length <= SERVICE_PACKAGE_LIMITS.fields,
    "Service input object exceeds its field limit.",
  );
  object(value, keys, "Service input object");
  for (const key of keys) {
    serviceName(key, "Service input field");
    validateJson(value[key], budget, depth + 1);
  }
}
