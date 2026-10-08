import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";

/** An expired inactive release can be rebuilt on the same Container from the checked artifact, without another model call. */
export function recoverExpiredAttachment(coordinator, claimed) {
  if (claimed.stepId !== "attach") return false;
  const now = coordinator.now();
  const task = coordinator.providers.task(claimed.id);
  if (
    !hasCurrentClaim(task, claimed, now) ||
    !coordinator.providers.expiredReplacement(task.id, now)
  )
    return false;
  coordinator.repository.update(
    task.id,
    { kind: "checkpoint", stepId: "host" },
    transitionGuard(task, now, taskClaim(task)),
  );
  return true;
}
