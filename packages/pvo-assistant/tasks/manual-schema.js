const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const manualAlternativeSchema = object({
  capabilityId: text(128),
  originalOutcome: text(1000),
  preparedOutcome: text(1000),
  limitation: text(1000),
  notice: text(1000),
  fields: {
    type: "array",
    maxItems: 8,
    items: object({
      name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,31}$" },
      kind: { enum: ["name", "email", "phone", "short", "number", "yesno"] },
      label: text(100),
      purpose: text(240),
    }),
  },
  steps: {
    type: "array",
    minItems: 1,
    maxItems: 8,
    items: object({ id: text(128), instruction: text(1000) }),
  },
});
