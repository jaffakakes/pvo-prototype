import type { NotificationId } from "../notifications/catalog";
import { AssistantPolicyError } from "../../../../packages/pvo-assistant/policy.js";

export type AssistantServiceErrorCode = "provider_allowance_exhausted";

export class AssistantServiceError extends Error {
  constructor(readonly status: number, message = `The assistant request failed (${status}).`, readonly code?: AssistantServiceErrorCode) {
    super(message);
    this.name = "AssistantServiceError";
  }
}

/** Provider text is diagnostic data, never notification copy. */
export function assistantFailureNotification(error: unknown): NotificationId {
  if (error instanceof AssistantPolicyError && error.code === "advanced_required") return "assistantAdvancedRequired";
  if (!(error instanceof AssistantServiceError)) return "assistantFailed";
  switch (error.status) {
    case 409: return "assistantAdvancedRequired";
    case 400: return "assistantInvalidRequest";
    case 413: return "assistantTooLarge";
    case 422: return "assistantUnsupported";
    case 429: return error.code === "provider_allowance_exhausted" ? "assistantAllowanceExhausted" : "assistantBusy";
    case 503: return "assistantUnavailable";
    case 504: return "assistantTimeout";
    default: return "assistantFailed";
  }
}
