import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { operationSchemas } from "../native/schema.js";
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const binding = {
  anyOf: [
    object({ kind: { const: "literal" }, value: {} }),
    object({
      kind: { const: "field" },
      name: { type: "string", maxLength: 64 },
    }),
    object({
      kind: { const: "object" },
      fields: {
        type: "array",
        maxItems: SERVICE_PACKAGE_LIMITS.fields,
        items: object({
          name: { type: "string", maxLength: 64 },
          value: { $ref: "#/$defs/binding" },
        }),
      },
    }),
    object({
      kind: { const: "array" },
      items: {
        type: "array",
        maxItems: SERVICE_PACKAGE_LIMITS.arrayItems,
        items: { $ref: "#/$defs/binding" },
      },
    }),
  ],
};
export const serviceAttachmentSchema = {
  ...object({
    kind: { const: "service.attach" },
    component: {
      anyOf: operationSchemas
        .filter((schema) =>
          ["component.add", "component.source"].includes(
            schema.properties.kind.const,
          ),
        )
        .map((schema) => ({
          ...schema,
          required: [...new Set([...schema.required, "source"])],
        })),
    },
    connection: object({
      releaseId: { type: "string", maxLength: 128 },
      operation: { type: "string", maxLength: 64 },
      event: { enum: ["press", "choose", "submit"] },
      target: { type: ["string", "null"], maxLength: 128 },
      input: { $ref: "#/$defs/binding" },
    }),
  }),
  $defs: { binding },
};
