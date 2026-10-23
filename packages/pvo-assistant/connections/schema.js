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
      object({ provider: { const: "agentmail" }, recipient: string(254) }),
      object({
        provider: { const: "resend" },
        from: string(254),
        recipient: string(254),
      }),
      object(fields),
      object({ ...fields, access: { const: "issues_write" } }),
    ],
  };
}
export function connectionBindingsSchema(data) {
  const reference = object({ input: string(64) });
  const adapter = object({
    name: {
      ...string(64),
      description:
        "Code identifier: lowercase first letter, then letters, digits or underscores; no hyphens.",
    },
    description: string(1024),
    provider: { enum: ["github", "resend", "agentmail"] },
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
    permission: {
      enum: ["repository:read", "issues:read", "issues:write", "email:send"],
    },
    completion: { const: "synchronous" },
    documentation: {
      ...string(2048),
      description:
        "One exact official HTTPS documentation URL only; no title, quotation or explanatory text.",
    },
  });
  return array(
    object({
      name: {
        ...string(64),
        description:
          "Local code identifier, separate from the saved connectionId: lowercase first letter, then letters, digits or underscores; no hyphens.",
      },
      connectionId: string(128),
      operations: {
        ...array(string(64), 8, 1),
        description:
          "Names from agreement.operations that may use this connection, not provider adapter operation IDs.",
      },
      adapter,
      examples: {
        ...array(object({ input: {}, result: {} }), 12, 1),
        description:
          "Every example input must be unique. Use one example when the input is fixed.",
      },
    }),
    4,
    1,
  );
}
