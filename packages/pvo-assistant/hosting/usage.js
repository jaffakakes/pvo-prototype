import {
  HOSTED_SERVICE_LIMITS as limits,
  serviceCallError,
} from "./actions.js";

/** Decide usage before dispatch; storage owns persistence, not the limits. */
export function admitServiceUsage(previous, now, execution) {
  const day = Math.floor(now / 86400000);
  const usage =
    previous?.day === day ? { ...previous } : { day, calls: 0, executions: 0 };
  const key = execution ? "executions" : "calls",
    maximum = execution ? limits.dailyExecutions : limits.dailyCalls;
  if (usage[key] >= maximum)
    throw serviceCallError(
      "budget_exceeded",
      "This service has reached its daily limit.",
    );
  return { ...usage, [key]: usage[key] + 1 };
}
export function requireServiceReceiptCapacity(usage, additionalBytes = 0) {
  if (
    usage.count >= limits.receipts ||
    usage.bytes + additionalBytes > limits.receiptBytes
  )
    throw serviceCallError(
      "budget_exceeded",
      "This service has reached its saved-action limit.",
    );
}
