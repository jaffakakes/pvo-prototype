import { canonicalJson } from "../services/json.js";
import { requireTask } from "../tasks/validation.js";
import { validateAttachmentInput } from "./input.js";
import {
  retryServiceSubmission,
  resolveBoundSubmissionInput,
} from "./submissions.js";

/** Restore only mapped form values, and prove the current binding recreates the saved input exactly. */
export function recoverServiceSubmissionFields(value, target, binding) {
  const saved = retryServiceSubmission(value, target);
  validateAttachmentInput(binding, saved.target.operation.input);
  const fields = new Map();
  function visit(item, input) {
    if (item.kind === "field") {
      requireTask(
        !fields.has(item.name) ||
          canonicalJson(fields.get(item.name)) === canonicalJson(input),
        "The saved submission contains conflicting form values.",
      );
      fields.set(item.name, input);
    } else if (item.kind === "object") {
      for (const field of item.fields) visit(field.value, input[field.name]);
    } else if (item.kind === "array")
      item.items.forEach((child, index) => visit(child, input[index]));
  }
  visit(binding, saved.action.input);
  const restored = Object.fromEntries(fields);
  requireTask(
    canonicalJson(
      resolveBoundSubmissionInput(binding, target.operation.input, restored),
    ) === canonicalJson(saved.action.input),
    "The saved input no longer matches this form's connection.",
  );
  return structuredClone(restored);
}
