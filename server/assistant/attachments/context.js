import { platformOrigin } from "../../../packages/pvo-assistant/attachments/policy.js";
import { hasCurrentClaim } from "../tasks/executionClaim.js";

/** Bounded public descriptions only. Source, private state, creator operations and authority stay server-side. */
export function attachmentPlanningContext(coordinator, claimed) {
  const task = coordinator.providers.task(claimed.id);
  if (
    !hasCurrentClaim(task, claimed, coordinator.now()) ||
    task.stepId !== "attach"
  )
    throw new Error("The attachment task is no longer current.");
  const rows = coordinator.providers
    .entries()
    .filter(
      (row) =>
        row.taskId === task.id &&
        row.settled &&
        row.outcome === "completed" &&
        !row.cancelled &&
        (!row.cancelRequested || row.retained),
    );
  const builder = coordinator.builders.get(task.id);
  const saved =
    builder && coordinator.artifacts.verified(task.id, builder.round);
  if (
    rows.length !== 1 ||
    !saved ||
    builder.reviewFeedback?.report?.status !== "passed"
  )
    throw new Error("The saved attachment needs one checked hosted release.");
  const identity = rows[0].identity;
  const origin = platformOrigin(coordinator.env.PUBLIC_ORIGIN);
  return {
    releaseId: identity.resourceId,
    url: `${origin}/api/services/${identity.serviceId}/actions`,
    operations: saved.artifact.agreement.operations.filter(
      (operation) => operation.audience === "public",
    ),
  };
}
