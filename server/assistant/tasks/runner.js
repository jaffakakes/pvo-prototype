import { withAssistantDeadline } from "../deadline.js";
import { creationDigest } from "./input.js";
import {
  taskBudgetIdentity,
  reserveTaskBudget,
  settleTaskBudget,
} from "./taskBudget.js";

/** One bounded planning step. Storage methods persist claims/intents before effects. */
export async function runAuthoringStep(coordinator, claimed) {
  const controller = new AbortController();
  coordinator.active.set(claimed.id, controller);
  let attempt;
  try {
    const operationId = `inference-${claimed.generation}`;
    const identity = await taskBudgetIdentity(
      claimed,
      operationId,
      coordinator.now(),
    );
    const digest = await creationDigest({
      input: claimed.input,
      questions: claimed.questions,
      stepId: claimed.stepId,
    });
    attempt = await coordinator.transaction(() =>
      coordinator.attempts.begin(claimed, identity, digest, coordinator.now()),
    );
    if (!attempt) return;
    let command = null;
    let code = null;
    let invoked = false;
    try {
      await withAssistantDeadline(
        async (signal) => {
          await reserveTaskBudget(coordinator.env, identity);
          signal.throwIfAborted();
          const dispatched = await coordinator.transaction(() =>
            coordinator.attempts.dispatch(claimed, attempt, coordinator.now()),
          );
          if (!dispatched) throw new DOMException("Task stopped", "AbortError");
          signal.throwIfAborted();
          if (!coordinator.attempts.current(claimed, coordinator.now()))
            throw new DOMException("Task stopped", "AbortError");
          // No await separates this last cancellation check from invoking the read-only planner.
          invoked = true;
          command = await coordinator.plan(claimed, signal);
        },
        coordinator.stepTimeoutMs(),
        controller.signal,
      );
    } catch (error) {
      if (!invoked) attempt.dispatched = false;
      code = stepFailureCode(error, controller.signal);
    }
    await coordinator.transaction(() =>
      coordinator.attempts.finish(
        claimed,
        attempt,
        command,
        code,
        coordinator.now(),
      ),
    );
  } finally {
    if (coordinator.active.get(claimed.id) === controller)
      coordinator.active.delete(claimed.id);
  }
}

export async function settleAuthoringBudgets(coordinator) {
  for (const attempt of coordinator.attempts
    .pendingBudget(coordinator.now())
    .slice(0, 4)) {
    try {
      const expired =
        coordinator.now() >=
        Date.parse(`${attempt.budget.day}T00:00:00Z`) + 25 * 3600000;
      if (!expired)
        await withAssistantDeadline(
          () =>
            settleTaskBudget(
              coordinator.env,
              attempt.budget,
              attempt.dispatched,
            ),
          5000,
        );
      await coordinator.transaction(() =>
        coordinator.attempts.budgetDone(attempt),
      );
    } catch {
      await coordinator.transaction(() =>
        coordinator.attempts.budgetFailed(attempt, coordinator.now()),
      );
    }
  }
}

function stepFailureCode(error, signal) {
  if (error?.status === 429) return "budget_exceeded";
  if (error?.code === "invalid_result") return "invalid_result";
  if (signal.aborted || error?.status === 504 || error?.name === "AbortError")
    return "interrupted";
  return "provider_unavailable";
}
