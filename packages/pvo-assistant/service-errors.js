/** Public failure reasons contain fixed copy, never provider text or project data. */
const definitions = {
  provider_allowance_exhausted: { status: 429, message: "The AI provider's daily allowance is exhausted. Try after it resets." },
  model_output_invalid: { status: 422, message: "The AI returned an invalid response. No changes were applied. Try again." },
  model_output_truncated: { status: 422, message: "The AI response ended before it was complete. No changes were applied. Try a smaller change." },
  edit_validation_failed: { status: 422, message: "The AI's proposed changes failed editor validation. No changes were applied. Try a smaller change." },
};

/** A status/code mismatch is untrusted, even when the code itself is known. */
export function assistantServiceErrorDefinition(code, status) {
  if (typeof code !== "string" || !Object.hasOwn(definitions, code)) return null;
  const definition = definitions[code];
  if (status !== undefined && status !== definition.status) return null;
  return { code, ...definition };
}
