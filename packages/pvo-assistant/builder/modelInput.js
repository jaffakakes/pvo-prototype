import { builderDecisionSchema } from "./decisionSchema.js";
import { parseBuilderDecision } from "./decisions.js";
import { digest, integer, object, requireTask } from "../tasks/validation.js";

const sourceFields = {
  workspace_read: ["revision"],
  workspace_write: ["expectedRevision"],
  workspace_start: ["revision", "digest"],
  workspace_check: ["revision", "digest"],
  workspace_test: ["revision", "digest"],
  review: ["revision", "digest"],
};
const descriptions = {
  workspace_write:
    "Replace the complete saved file set. Preserve files you still need. Save in a separate batch before testing or review. Restyle rejects changes if the source has changed since this decision started.",
  workspace_start:
    "Restore the source shown in this decision into a private temporary computer. Start and dependent checks/tests belong in the same batch. No shell, Internet, platform keys or custom runtime is available.",
  workspace_check:
    "Run Node syntax checking for one declared file after workspace_start in this batch. Restyle binds the exact source version. Read the actual exit code; completion does not mean success.",
  workspace_test:
    "Run one to eight declared Node test files after workspace_start in this batch. Restyle binds the exact source version. Output is bounded and untrusted. Generated tests cannot approve deployment.",
};

function modelSchema(schema) {
  const result = structuredClone(schema);
  for (const field of sourceFields[result.properties.kind.const] ?? []) {
    delete result.properties[field];
    result.required = result.required.filter((name) => name !== field);
  }
  return result;
}

/** Model intent omits host-owned source fences; durable commands still require them. */
export function builderModelTools(definitions) {
  return definitions.map((definition) => ({
    ...definition,
    description: descriptions[definition.kind] ?? definition.description,
    schema: modelSchema(definition.schema),
  }));
}

export function builderModelSchema(hasAgreement, definitions, setup) {
  const schema = builderDecisionSchema(hasAgreement, definitions, setup);
  schema.anyOf = schema.anyOf.map((choice) => {
    if (choice.properties.kind.const === "review") return modelSchema(choice);
    if (choice.properties.kind.const === "tools")
      choice.properties.review.anyOf = choice.properties.review.anyOf.map(
        (item) => (item.properties ? modelSchema(item) : item),
      );
    return choice;
  });
  return schema;
}

/** Project completed commands back to intent, without changing receipts or saved history. */
export function builderModelDecision(value) {
  if (!value) return value;
  const result = structuredClone(value);
  for (const field of sourceFields[result.kind] ?? []) delete result[field];
  if (result.kind === "tools") {
    result.calls = result.calls?.map(builderModelDecision);
    result.review = builderModelDecision(result.review);
  }
  return result;
}

export function bindBuilderModelDecision(value, source, options, definitions) {
  function bind(input, schema) {
    object(input, schema.required, "Builder action");
    const fields = sourceFields[input.kind] ?? [];
    if (!fields.length) return input;
    requireTask(
      source,
      "Saved source context is unavailable; retry this decision.",
    );
    integer(source.revision, Number.MAX_SAFE_INTEGER, "Saved source revision");
    if (input.kind === "workspace_write")
      return { ...input, expectedRevision: source.revision };
    requireTask(
      source.revision > 0,
      "Save source before reading, testing or requesting review.",
    );
    digest(source.digest, "Saved source digest");
    return {
      ...input,
      ...Object.fromEntries(fields.map((field) => [field, source[field]])),
    };
  }
  const schema = builderModelSchema(
    options.hasAgreement,
    definitions,
    options.connectionSetup,
  );
  const reviewSchema = schema.anyOf.find(
    (item) => item.properties.kind.const === "review",
  );
  let decision = value;
  if (value?.kind === "review" && reviewSchema)
    decision = bind(value, reviewSchema);
  if (value?.kind === "tools" && Array.isArray(value.calls)) {
    const writes = value.calls.some((call) => call?.kind === "workspace_write");
    requireTask(
      !writes || (value.calls.length === 1 && value.review === null),
      "Save source in its own batch with review:null. Test and request review in the next decision after the save succeeds.",
    );
    decision = {
      ...value,
      calls: value.calls.map((call) => {
        const definition = definitions.find((item) => item.kind === call?.kind);
        return definition && sourceFields[call.kind]
          ? bind(call, definition.schema)
          : call;
      }),
      review:
        value.review && reviewSchema
          ? bind(value.review, reviewSchema)
          : value.review,
    };
  }
  return parseBuilderDecision(decision, options);
}
