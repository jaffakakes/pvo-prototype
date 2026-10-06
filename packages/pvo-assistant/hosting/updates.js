import { parseServiceAgreement, parseServiceState } from "../services/index.js";
import { canonicalJson } from "../services/json.js";
import { serviceCallError } from "./actions.js";
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
function shape(value) {
  if (value.type === "object")
    return {
      type: "object",
      fields: value.fields
        .map(({ name, schema }) => ({ name, schema: shape(schema) }))
        .sort(byName),
    };
  if (value.type === "array") return { ...value, items: shape(value.items) };
  if (value.type === "enum")
    return { ...value, values: [...value.values].sort() };
  return value;
}
function operations(agreement) {
  return agreement.operations
    .map(({ name, audience, access, input, result }) => ({
      name,
      audience,
      access,
      input: shape(input),
      result: shape(result),
    }))
    .sort(byName);
}
/** Existing component inputs, replies and audiences must keep their meaning. Rollback validates today's records, never a saved copy. */
export function prepareReleaseActivation(previous, candidate, state) {
  try {
    candidate = parseServiceAgreement(candidate);
    if (
      previous &&
      canonicalJson(operations(parseServiceAgreement(previous))) !==
        canonicalJson(operations(candidate))
    )
      throw new Error("Operation interface changed.");
    return parseServiceState(candidate, state);
  } catch {
    throw serviceCallError(
      "incompatible_version",
      "This version cannot use the existing service contract or records. The current version is unchanged.",
    );
  }
}
