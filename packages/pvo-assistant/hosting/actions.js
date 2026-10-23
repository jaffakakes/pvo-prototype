import { object, id, boundedJson } from "../tasks/validation.js";
import {
  parseServiceInvocation,
  parseServiceReply,
} from "../services/index.js";
import { canonicalJson } from "../services/json.js";

export const HOSTED_SERVICE_LIMITS = Object.freeze({
  requestBytes: 16 * 1024,
  queued: 8,
  dailyCalls: 1024,
  dailyExecutions: 256,
  receipts: 512,
  receiptBytes: 2 * 1024 * 1024,
});
export function serviceCallError(code, message) {
  return Object.assign(new Error(message), { code });
}
export function parseServiceAction(value) {
  object(value, ["actionId", "operation", "input"], "Service action");
  id(value.actionId, "Service action ID");
  id(value.operation, "Service operation");
  boundedJson(value, HOSTED_SERVICE_LIMITS.requestBytes, "Service action");
  return structuredClone(value);
}
export const serializeServiceAction = (value) =>
  canonicalJson(parseServiceAction(value));
export function prepareHostedInvocation(
  agreement,
  action,
  state,
  now,
  audience,
) {
  const operation = agreement.operations.find(
    (item) => item.name === action.operation,
  );
  if (
    !operation ||
    (operation.audience === "creator" && audience !== "creator")
  )
    throw serviceCallError("forbidden", "This operation is unavailable.");
  try {
    return parseServiceInvocation(agreement, {
      operation: action.operation,
      input: action.input,
      state,
      now,
    });
  } catch {
    throw serviceCallError(
      "invalid_input",
      "The action does not match this service.",
    );
  }
}
export function checkedHostedReply(agreement, invocation, reply) {
  try {
    return parseServiceReply(agreement, invocation, reply);
  } catch {
    throw serviceCallError(
      "invalid_result",
      "This service returned an invalid result.",
    );
  }
}
export function replayServiceAction(receipt, action, digest, audience) {
  if (!receipt) return null;
  if (receipt.operation !== action.operation || receipt.inputDigest !== digest)
    throw serviceCallError(
      "action_conflict",
      "This action ID was already used with different input.",
    );
  if (receipt.audience === "creator" && audience !== "creator")
    throw serviceCallError("forbidden", "This operation is unavailable.");
  return {
    actionId: receipt.actionId,
    result: structuredClone(receipt.result),
  };
}
