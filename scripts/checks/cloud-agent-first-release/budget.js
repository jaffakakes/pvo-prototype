import { AssistantBudget } from "../../../server/assistant/budget.js";

/** Optional, separately approved capacity policy for this isolated paid diagnostic only. */
export class AcceptanceBudget extends AssistantBudget {
  dailyLimits() {
    const expiresAt = Number(this.env.PROOF_EXPIRES_AT);
    if (
      this.env.PROOF_SPENDING_POLICY !== "settled-usage" ||
      !Number.isSafeInteger(expiresAt) ||
      this.now() >= expiresAt
    )
      return super.dailyLimits();
    // The existing reservation-table bound still applies. Every actual model
    // dispatch separately reserves its worst-case dollars in ProofModelMeter.
    return { global: 4096, client: 4096 };
  }
}
