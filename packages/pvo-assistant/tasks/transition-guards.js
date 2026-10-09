import { hasPendingManualSteps } from "./manual.js";
import { TASK_LIMITS } from "./limits.js";
import { object, requireTask, time, integer, id } from "./validation.js";

export function validateGuard(task, guard) {
  object(
    guard,
    ["ownerId", "expectedRevision", "now", "claim"],
    "Transition guard",
  );
  requireTask(guard.ownerId === task.ownerId, "Task access denied.");
  integer(guard.expectedRevision, Number.MAX_SAFE_INTEGER, "Expected revision");
  requireTask(
    guard.expectedRevision === task.revision,
    "Task revision is stale.",
  );
  time(guard.now, "Command time");
  requireTask(
    guard.now >= task.updatedAt,
    "Command time precedes saved task state.",
  );
  if (guard.claim !== null) {
    object(guard.claim, ["id", "generation"], "Claim guard");
    id(guard.claim.id, "Claim guard ID");
    integer(
      guard.claim.generation,
      Number.MAX_SAFE_INTEGER,
      "Claim generation",
    );
  }
}

export function requireRunningClaim(task, guard) {
  requireTask(
    task.state === "running" &&
      task.claim !== null &&
      guard.claim !== null &&
      guard.claim.id === task.claim.id &&
      guard.claim.generation === task.generation &&
      guard.now < task.claim.expiresAt,
    "Execution claim is missing, expired, or stale.",
  );
}

export function finishClaim(task, state) {
  task.state = state;
  task.wait = null;
  if (["ready", "stopped"].includes(state) && !hasPendingManualSteps(task)) {
    task.finishedAt = task.updatedAt;
    task.expiresAt = task.finishedAt + TASK_LIMITS.retentionMs;
  }
  task.claim = null;
  task.generation++;
  task.nextRunAt = state === "queued" ? task.updatedAt : null;
}

export function requireSettledUsage(task) {
  requireTask(
    !task.usage.reservedModelTurns && !task.usage.reservedToolCalls,
    "Usage reservations must be settled first.",
  );
}

/** Assert the trusted adapter may start an effect without changing the task. */
export function assertTaskExecution(task, guard) {
  validateGuard(task, guard);
  requireRunningClaim(task, guard);
}
