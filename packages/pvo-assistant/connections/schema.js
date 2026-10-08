const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const string = (maxLength) => ({ type: "string", maxLength });
const array = (items, maxItems, minItems = 0) => ({
  type: "array",
  items,
  maxItems,
  minItems,
});

export function connectionSetupSchema() {
  const fields = { provider: { const: "github" }, repository: string(140) };
  return {
    anyOf: [
      object(fields),
      object({ ...fields, access: { const: "issues_write" } }),
    ],
  };
}
export function connectionBindingsSchema(data) {
  const reference = object({ input: string(64) });
  const adapter = object({
    name: string(64),
    description: string(1024),
    provider: { const: "github" },
    method: { enum: ["GET", "POST"] },
    path: array({ anyOf: [string(64), reference] }, 3),
    query: array(
      object({
        name: { enum: ["state", "page", "per_page", "sort", "direction"] },
        value: { anyOf: [string(64), reference] },
      }),
      5,
    ),
    input: data,
    result: data,
    responsePath: array(string(64), 4),
    permission: { enum: ["repository:read", "issues:read", "issues:write"] },
    completion: { const: "synchronous" },
    documentation: string(2048),
  });
  return array(
    object({
      name: string(64),
      connectionId: string(128),
      operations: array(string(64), 8, 1),
      adapter,
      examples: array(object({ input: {}, result: {} }), 12, 1),
    }),
    4,
    1,
  );
}
