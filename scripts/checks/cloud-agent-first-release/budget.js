import { AssistantBudget } from "../../../server/assistant/budget.js";
import { WorkspaceBudget } from "../../../server/assistant/workspaces/budget.js";

function completionPolicy(env, now) {
  const expiresAt = Number(env.PROOF_EXPIRES_AT);
  return (
    env.PROOF_SPENDING_POLICY === "settled-usage" &&
    Number.isSafeInteger(expiresAt) &&
    now < expiresAt
  );
}

/** Optional, separately approved capacity policy for this isolated paid diagnostic only. */
export class AcceptanceBudget extends AssistantBudget {
  dailyLimits() {
    if (!completionPolicy(this.env, this.now())) return super.dailyLimits();
    // The existing reservation-table bound still applies. Every actual model
    // dispatch separately reserves its worst-case dollars in ProofModelMeter.
    return { global: 4096, client: 4096 };
  }
}

/** Same recorded resource and concurrency controls, under the 1F completion authorization. */
export class AcceptanceWorkspaceBudget extends WorkspaceBudget {
  dailySessionLimit() {
    return completionPolicy(this.env, this.now())
      ? 4096
      : super.dailySessionLimit();
  }
}
