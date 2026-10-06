import {
  choice,
  integer,
  list,
  object,
  requireTask as requireService,
  text,
  unique,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS as limits } from "./limits.js";

export function serviceName(value, path) {
  requireService(
    typeof value === "string" &&
      /^[a-z][a-zA-Z0-9_]{0,63}$/.test(value) &&
      !["constructor", "prototype"].includes(value),
    `${path} must be a safe name of at most 64 characters.`,
  );
}

/** A bounded data-description language, not executable JSON Schema or code. */
export function validateSchema(value, budget, depth = 0) {
  requireService(
    depth <= limits.schemaDepth && ++budget.nodes <= limits.schemaNodes,
    "Service data description exceeds its depth or size limit.",
  );
  // Read the discriminant without invoking an accessor on malformed JS input.
  const type = value && Object.getOwnPropertyDescriptor(value, "type")?.value;
  const path = "Service data description";
  switch (type) {
    case "null":
    case "boolean":
      object(value, ["type"], path);
      break;
    case "string":
      object(value, ["type", "maxBytes"], path);
      integer(value.maxBytes, limits.stringBytes, "String byte limit", 1);
      break;
    case "number":
    case "integer":
      object(value, ["type", "minimum", "maximum"], path);
      for (const bound of [value.minimum, value.maximum])
        requireService(
          typeof bound === "number" &&
            Number.isFinite(bound) &&
            Math.abs(bound) <= Number.MAX_SAFE_INTEGER &&
            (type !== "integer" || Number.isSafeInteger(bound)),
          "Numeric bounds must be finite and within the safe range.",
        );
      requireService(
        value.minimum <= value.maximum,
        "Numeric bounds are reversed.",
      );
      break;
    case "enum":
      object(value, ["type", "values"], path);
      list(value.values, 32, "Enum values");
      requireService(value.values.length > 0, "An enum needs values.");
      for (const item of value.values) text(item, 256, "Enum value");
      unique(value.values, "Enum values");
      break;
    case "array":
      object(value, ["type", "maxItems", "items"], path);
      integer(value.maxItems, limits.arrayItems, "Array item limit", 1);
      validateSchema(value.items, budget, depth + 1);
      break;
    case "object":
      object(value, ["type", "fields"], path);
      list(value.fields, limits.fields, "Object fields");
      for (const field of value.fields) {
        object(field, ["name", "description", "schema"], "Object field");
        serviceName(field.name, "Field name");
        text(field.description, 512, "Field description");
        validateSchema(field.schema, budget, depth + 1);
      }
      unique(
        value.fields.map((field) => field.name),
        "Object field names",
      );
      break;
    default:
      throw new Error("Unsupported service data description.");
  }
}

/** Schema has already passed validateSchema. Object fields are all required. */
function validateValue(schema, value, path, budget) {
  switch (schema.type) {
    case "null":
      requireService(value === null, `${path} must be null.`);
      break;
    case "boolean":
      requireService(typeof value === "boolean", `${path} must be boolean.`);
      break;
    case "string":
      text(value, schema.maxBytes, path, true);
      break;
    case "number":
    case "integer":
      requireService(
        typeof value === "number" &&
          Number.isFinite(value) &&
          value >= schema.minimum &&
          value <= schema.maximum &&
          (schema.type !== "integer" || Number.isSafeInteger(value)),
        `${path} is outside its numeric range.`,
      );
      break;
    case "enum":
      choice(value, schema.values, path);
      break;
    case "array":
      list(value, schema.maxItems, path);
      spendBytes(budget, 2 + Math.max(0, value.length - 1), path);
      value.forEach((item, index) =>
        validateValue(schema.items, item, `${path}[${index}]`, budget),
      );
      return;
    case "object":
      object(
        value,
        schema.fields.map((field) => field.name),
        path,
      );
      spendBytes(
        budget,
        2 +
          Math.max(0, schema.fields.length - 1) +
          schema.fields.reduce(
            (bytes, field) => bytes + field.name.length + 3,
            0,
          ),
        path,
      );
      for (const field of schema.fields)
        validateValue(
          field.schema,
          value[field.name],
          `${path}.${field.name}`,
          budget,
        );
      return;
    default:
      throw new Error("Unsupported service data description.");
  }
  spendBytes(
    budget,
    new TextEncoder().encode(JSON.stringify(value)).length,
    path,
  );
}

function spendBytes(budget, bytes, path) {
  budget.remaining -= bytes;
  requireService(
    budget.remaining >= 0,
    `${path} exceeds its total byte limit.`,
  );
}

export function boundedValue(schema, value, maximum, path) {
  // Spend the byte budget during traversal, before serializing a potentially
  // enormous nested value. Closed schemas make container overhead exact.
  validateValue(schema, value, path, { remaining: maximum });
}
