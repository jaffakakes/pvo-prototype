import { TASK_LIMITS } from "../../../packages/pvo-assistant/tasks/index.js";
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
    const retained = coordinator.providers
      .entries()
      .some(
        (row) =>
          row.taskId === claimed.id &&
          row.settled &&
          row.outcome === "completed" &&
          !row.cancelled &&
          !row.cancelRequested,
      );
    if (!retained && claimed.usage.toolCalls >= TASK_LIMITS.toolCalls)
      throw Object.assign(new Error("Task tool limit reached."), {
        code: "budget_exceeded",
      });
    const row = await publishTaskService(coordinator, claimed);
    if (!row?.settled) return;
    if (
      row.outcome !== "completed" ||
      row.cancelled ||
      row.cancelRequested ||
      coordinator.services.release(row.identity.resourceId)?.state !==
        "inactive"
    )
      throw Object.assign(new Error("Inactive service is unavailable."), {
        code: "execution_failed",
      });
    await commit({ kind: "checkpoint", stepId: "attach" });
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
