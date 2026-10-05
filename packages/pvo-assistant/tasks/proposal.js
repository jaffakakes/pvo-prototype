import { TASK_LIMITS as limits } from "./limits.js";
import { object, requireTask } from "./validation.js";
import { validateExamples } from "./content.js";

/** A model can suggest a saved task, never assign its owner, IDs, provider or effects. */
export const taskProposalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["examples"],
  properties: {
    examples: {
      type: "array",
      minItems: 1,
      maxItems: limits.examples,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "input", "expected"],
        properties: {
          id: { type: "string", maxLength: limits.idBytes },
          input: { type: "string", maxLength: limits.exampleBytes },
          expected: { type: "string", maxLength: limits.exampleBytes },
        },
      },
    },
  },
};

export function parseTaskProposal(value) {
  object(value, ["examples"], "Saved task proposal");
  validateExamples(value.examples);
  requireTask(
    value.examples.length > 0,
    "Describe at least one expected behavior before starting a task.",
  );
  return structuredClone(value);
}
