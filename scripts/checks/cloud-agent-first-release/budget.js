import { WorkspaceBudget } from "../../../server/assistant/workspaces/budget.js";

function completionPolicy(env, now) {
  const expiresAt = Number(env.PROOF_EXPIRES_AT);
  return (
    env.PROOF_SPENDING_POLICY === "settled-usage" &&
    Number.isSafeInteger(expiresAt) &&
    now < expiresAt
  );
}

/** Same recorded resource and concurrency controls, under the 1F completion authorization. */
export class AcceptanceWorkspaceBudget extends WorkspaceBudget {
  dailySessionLimit() {
    return completionPolicy(this.env, this.now())
      ? 4096
      : super.dailySessionLimit();
  }
}
