import { validateNoCodeAssistantProposal } from "../../../../packages/pvo-assistant/no-code-policy.js";
import { componentLanguageModel } from "../components/languageEditing";
import type { AssistantReview } from "./review";

/** Recheck the complete change against the current switch, including stacked proposals. */
export function validateAssistantEditingMode(review: AssistantReview, advanced: boolean): void {
  if (advanced) return;
  validateNoCodeAssistantProposal(componentLanguageModel(review.original), review.proposal.compiled);
}
