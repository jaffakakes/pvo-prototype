import { publishTaskService } from "../tasks/providerRunner.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";

/** Only task-owned checked artifacts reach the private publisher. A hosted inactive release still needs attachment. */
export async function runHostingStep(coordinator, claimed) {
  const commit = (command) =>
    coordinator.transaction(() => {
      const task = coordinator.providers.task(claimed.id),
        now = coordinator.now();
      if (hasCurrentClaim(task, claimed, now))
        coordinator.repository.update(
          task.id,
          command,
          transitionGuard(task, now, taskClaim(task)),
        );
    });
  try {
    const row = await publishTaskService(coordinator, claimed);
    if (!row?.settled) return;
    if (
      row.outcome !== "completed" ||
      row.cancelled ||
      (row.cancelRequested && !row.retained) ||
      !["inactive", "retained"].includes(
        coordinator.services.release(row.identity.resourceId)?.state,
      )
    )
      throw Object.assign(new Error("Inactive service is unavailable."), {
        code: "execution_failed",
      });
    await commit({
      kind: "checkpoint",
      stepId: claimed.input.context.container ? "draft_finish" : "attach",
    });
  } catch (error) {
    const code = [
      "invalid_result",
      "budget_exceeded",
      "execution_failed",
    ].includes(error?.code)
      ? error.code
      : "execution_failed";
    await commit({ kind: "fail", failure: { code, stepId: "host" } });
  }
}
