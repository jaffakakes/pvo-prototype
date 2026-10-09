import { verificationMessages } from "../../server/account-onboarding/messages.js";
import { HttpError } from "../../server/http.js";

/** Fixture-only access; no production route accepts plans or reveals encrypted storage. */
export function fixtureVerificationMessages(coordinator, provider) {
  return verificationMessages(provider, (url, options) =>
    coordinator.env.CONNECTION_API.fetch(url, options),
  );
}
export async function fixtureVerification(coordinator, ownerId, input) {
  try {
    return await runFixtureVerification(coordinator, ownerId, input);
  } catch (error) {
    return {
      error: "Private verification fixture unavailable",
      status: error instanceof HttpError ? error.status : 503,
    };
  }
}
async function runFixtureVerification(coordinator, ownerId, input) {
  coordinator.repository.bindOwner(ownerId);
  const manager = coordinator.accountVerification;
  if (input.kind === "storage")
    return coordinator.ctx.storage.sql
      .exec("SELECT * FROM account_verifications")
      .toArray();
  const task = coordinator.repository.read(input.taskId, coordinator.now());
  const claimed = { ...task, ...(input.claim ?? {}) };
  switch (input.kind) {
    case "prepare":
      return manager.prepare(claimed, input.plan);
    case "activate":
      return manager.activate(claimed, input.operationId);
    case "poll":
      return manager.poll(claimed, input.operationId);
    case "consume":
      return manager.consume(
        claimed,
        input.operationId,
        async ({ code, signal }) => {
          await coordinator.env.CONNECTION_API.fetch(
            "https://consumer.test/verify",
            {
              method: "POST",
              body: JSON.stringify({ code, operationId: input.operationId }),
              signal,
            },
          );
          return input.accepted === true;
        },
      );
    default:
      throw new Error("Unknown fixture verification command");
  }
}
