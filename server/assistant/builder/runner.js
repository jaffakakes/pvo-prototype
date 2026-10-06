import { taskBuilderTools } from "./taskToolsRegistry.js";
import { BUILDER_RESEARCH_KINDS } from "../../../packages/pvo-assistant/builder/index.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";

function haltBatch(result) {
  return (
    result?.status === "interrupted" ||
    result?.status === "unknown" ||
    result?.status === "unavailable" ||
    result?.status === "pending" ||
    (result?.kind === "command" && result.result?.exitCode !== 0)
  );
}

function capacityWait(coordinator, claimed, result, tool) {
  if (
    tool.kind !== "workspace_start" ||
    result?.status !== "interrupted" ||
    !["workspace_capacity", "workspace_allowance"].includes(result.result?.code)
  )
    return false;
  const task = coordinator.builders.task(claimed.id),
    now = coordinator.now();
  if (!hasCurrentClaim(task, claimed, now)) return false;
  coordinator.repository.update(
    task.id,
    {
      kind: "wait",
      reason: result.result.code,
      nextRunAt: Math.max(now + 1000, result.result.retryAt),
    },
    transitionGuard(task, now, taskClaim(task)),
  );
  return true;
}

function checkpoint(coordinator, claimed) {
  const task = coordinator.builders.task(claimed.id),
    now = coordinator.now();
  if (!hasCurrentClaim(task, claimed, now)) return;
  coordinator.repository.update(
    task.id,
    {
      kind: "checkpoint",
      stepId:
        coordinator.builders.stage(task.id) === "review" ? "validate" : "build",
    },
    transitionGuard(task, now, taskClaim(task)),
  );
}

/** Saved batches own a separate claim from inference; each real receipt commits before the next tool. */
export async function runBuilderBatch(coordinator, claimed) {
  if (coordinator.builders.stage(claimed.id) === "review") {
    await coordinator.transaction(() => checkpoint(coordinator, claimed));
    return;
  }
  const started = await coordinator.transaction(() =>
    coordinator.builders.beginBatch(claimed, coordinator.now()),
  );
  if (!started) return;
  if (started.interrupted) {
    // Cleanup and receipt reconciliation have finished before claimNext admits this task.
    // Consume completed effects, then abandon dependent commands against the old computer.
    await coordinator.transaction(() => {
      while (coordinator.builders.next(claimed.id)) {
        const position = coordinator.builders.next(claimed.id);
        if (BUILDER_RESEARCH_KINDS.includes(position.tool.kind)) {
          const row = coordinator.research.get(
            claimed.id,
            position.operationId,
          );
          if (!row?.settled) break;
          coordinator.builders.recoveredFeedback(
            claimed,
            position,
            row.result,
            haltBatch(row.result),
            coordinator.now(),
          );
          continue;
        }
        const row = coordinator.workspaces.get(
          `${claimed.id}_${position.operationId}`,
        );
        if (!row?.settled) break;
        const result = row.receipt
          ? row.kind === "read"
            ? position.tool.kind === "workspace_result" &&
              row.receipt.result === null
              ? {
                  operationId: position.tool.operationId,
                  status: "unknown",
                  result: null,
                }
              : row.receipt.result
            : row.receipt
          : { status: "unknown", result: null };
        coordinator.builders.recoveredFeedback(
          claimed,
          position,
          result,
          haltBatch(result),
          coordinator.now(),
        );
        if (capacityWait(coordinator, claimed, result, position.tool)) return;
      }
      if (coordinator.builders.stage(claimed.id) === "tools")
        coordinator.builders.interrupt(claimed, coordinator.now());
      checkpoint(coordinator, claimed);
    });
    return;
  }
  const tools = taskBuilderTools(coordinator, claimed);
  try {
    for (let position; (position = coordinator.builders.next(claimed.id));) {
      if (!coordinator.builders.current(claimed, coordinator.now())) return;
      const result = await tools.execute(position.tool, position.operationId);
      const saved = await coordinator.transaction(() => {
        const accepted = coordinator.builders.feedback(
          claimed,
          position,
          result,
          haltBatch(result),
          coordinator.now(),
        );
        if (accepted) capacityWait(coordinator, claimed, result, position.tool);
        return accepted;
      });
      if (!saved) return;
    }
    await coordinator.transaction(() => checkpoint(coordinator, claimed));
  } catch (error) {
    // Unknown effects have already failed/fenced the task and must be looked up before resuming.
    await fail(
      coordinator,
      claimed,
      ["reconciliation_required", "budget_exceeded"].includes(error?.code)
        ? error.code
        : "invalid_result",
    );
  }
}

async function fail(coordinator, claimed, code) {
  await coordinator.transaction(() => {
    const task = coordinator.builders.task(claimed.id),
      now = coordinator.now();
    if (hasCurrentClaim(task, claimed, now))
      coordinator.repository.update(
        task.id,
        { kind: "fail", failure: { code, stepId: "build" } },
        transitionGuard(task, now, taskClaim(task)),
      );
  });
}
