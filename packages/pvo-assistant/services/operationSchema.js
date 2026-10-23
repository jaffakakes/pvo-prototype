import { choice, object, text } from "../tasks/validation.js";
import { serviceName, validateSchema } from "./values.js";

export function validateOperation(value, budget) {
  object(
    value,
    [
      "name",
      "description",
      "audience",
      "access",
      "input",
      "result",
      ...(Object.hasOwn(value, "delivery") ? ["delivery"] : []),
    ],
    "Service operation",
  );
  serviceName(value.name, "Operation name");
  text(value.description, 1024, "Operation description");
  choice(value.audience, ["public", "creator"], "Operation audience");
  choice(value.access, ["read", "write"], "Operation storage access");
  if (Object.hasOwn(value, "delivery"))
    choice(value.delivery, ["background"], "Operation delivery");
  validateSchema(value.input, budget);
  validateSchema(value.result, budget);
}

/** A description of one operation contains no state, source, tests or credentials. */
export function parseServiceOperation(value) {
  validateOperation(value, { nodes: 0 });
  return structuredClone(value);
}
