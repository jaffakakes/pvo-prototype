import {
  boundedJson,
  object,
  requireTask as requireService,
  time,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS as limits } from "./limits.js";
import { boundedValue } from "./values.js";
import { canonicalJson } from "./json.js";

/** Internal rules consume a validated agreement; public entry points validate it first. */
export function validateInvocation(agreement, value) {
  object(value, ["operation", "input", "state", "now"], "Service invocation");
  const operation = agreement.operations.find(
    (item) => item.name === value.operation,
  );
  requireService(operation, "Unknown service operation.");
  time(value.now, "Service invocation time");
  boundedValue(
    operation.input,
    value.input,
    limits.inputBytes,
    "Operation input",
  );
  boundedValue(
    agreement.state.schema,
    value.state,
    limits.stateBytes,
    "Service state",
  );
  boundedJson(value, limits.envelopeBytes, "Service invocation");
  return operation;
}

export function validateReply(agreement, invocation, value) {
  const operation = validateInvocation(agreement, invocation);
  object(value, ["result", "state"], "Service reply");
  boundedValue(
    operation.result,
    value.result,
    limits.resultBytes,
    "Operation result",
  );
  boundedValue(
    agreement.state.schema,
    value.state,
    limits.stateBytes,
    "Proposed service state",
  );
  boundedJson(value, limits.envelopeBytes, "Service reply");
  requireService(
    operation.access !== "read" ||
      canonicalJson(value.state) === canonicalJson(invocation.state),
    "A read operation cannot change service state.",
  );
}
