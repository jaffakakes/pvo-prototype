import { SERVICE_PACKAGE_LIMITS as service } from "../services/index.js";
import { TASK_LIMITS } from "../tasks/index.js";
import { WORKSPACE_LIMITS } from "../workspaces/index.js";
import { BUILDER_LIMITS } from "./decisions.js";

const string = (maximum) => ({ type: "string", maxLength: maximum });
const array = (items, maximum, minimum = 0) => ({
  type: "array",
  items,
  maxItems: maximum,
  minItems: minimum,
});
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const data = { $ref: "#/$defs/data" };
const dataDescription = {
  anyOf: [
    object({ type: { const: "null" } }),
    object({ type: { const: "boolean" } }),
    object({
      type: { const: "string" },
      maxBytes: { type: "integer", minimum: 1, maximum: service.stringBytes },
    }),
    ...["integer", "number"].map((type) =>
      object({ type: { const: type }, minimum: { type }, maximum: { type } }),
    ),
    object({ type: { const: "enum" }, values: array(string(256), 32, 1) }),
    object({
      type: { const: "array" },
      maxItems: { type: "integer", minimum: 1, maximum: service.arrayItems },
      items: data,
    }),
    object({
      type: { const: "object" },
      fields: array(
        object({ name: string(64), description: string(512), schema: data }),
        service.fields,
      ),
    }),
  ],
};
const agreement = object({
  description: string(2048),
  state: object({ schema: data, initial: {} }),
  operations: array(
    object({
      name: string(64),
      description: string(1024),
      audience: { enum: ["public", "creator"] },
      access: { enum: ["read", "write"] },
      input: data,
      result: data,
    }),
    service.operations,
    1,
  ),
  cases: array(
    object({
      id: string(TASK_LIMITS.idBytes),
      description: string(1024),
      initialState: {},
      steps: array(
        object({
          operation: string(64),
          input: {},
          now: { type: "integer", minimum: 0 },
          expected: object({ result: {}, state: {} }),
        }),
        service.caseSteps,
        1,
      ),
    }),
    service.cases,
    1,
  ),
});

/** Only the current phase's choices enter the model schema; runtime validation remains authoritative. */
export function builderDecisionSchema(hasAgreement, definitions) {
  const ask = object({
    kind: { const: "ask" },
    prompt: string(TASK_LIMITS.questionBytes),
    choices: array(string(TASK_LIMITS.choiceBytes), TASK_LIMITS.choices),
  });
  const review = object({
    kind: { const: "review" },
    revision: {
      type: "integer",
      minimum: 1,
      maximum: WORKSPACE_LIMITS.operations,
    },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    entrypoint: string(160),
    tests: array(string(160), service.tests, 1),
  });
  return structuredClone({
    $defs: { data: dataDescription },
    anyOf: hasAgreement
      ? [
          ask,
          ...(definitions.length
            ? [
                object({
                  kind: { const: "tools" },
                  review: { anyOf: [{ type: "null" }, review] },
                  calls: array(
                    { anyOf: definitions.map((tool) => tool.schema) },
                    BUILDER_LIMITS.batchCalls,
                    1,
                  ),
                }),
              ]
            : []),
          review,
        ]
      : [ask, object({ kind: { const: "agreement" }, agreement })],
  });
}
