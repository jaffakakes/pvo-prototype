import {
  transitionTask,
  TASK_LIMITS,
} from "../../../packages/pvo-assistant/tasks/index.js";
import { HttpError } from "../../http.js";
import { randomId } from "../../identity.js";

/** Admit one bounded step after expired claims, receipts and cleanup are reconciled. */
export function claimNextTask(coordinator) {
  const now = coordinator.now();
  coordinator.noteTerminal(now);
  coordinator.repository.maintain(now, coordinator.heldTasks());
  for (const [id, controller] of coordinator.active) {
    const task = coordinator.attempts.task(id);
    if (!task || task.state !== "running" || task.claim.expiresAt <= now)
      controller.abort();
  }
  coordinator.attempts.recover(now);
  coordinator.research.recover(now);
  coordinator.validation.recover(now);
  coordinator.noteTerminal(now);
  coordinator.repository.maintain(now, coordinator.heldTasks());
  coordinator.attempts.prune();
  coordinator.results.prune();
  coordinator.builders.prune(now);
  for (let task of coordinator.repository.records()) {
    if (task.state === "running" && task.claim.expiresAt <= now) {
      const recovered = transitionTask(
        task,
        { kind: "recover" },
        {
          ownerId: task.ownerId,
          expectedRevision: task.revision,
          now,
          claim: null,
        },
      );
      coordinator.repository.save(recovered, task.revision);
      task = recovered;
    }
    if (
      task.state === "failed" &&
      task.failure.code === "reconciliation_required" &&
      task.stepId === "build" &&
      coordinator.builders.stage(task.id) === "tools" &&
      now < task.deadlineAt &&
      task.retries < TASK_LIMITS.retries &&
      !coordinator.awaiting(task.id) &&
      !task.usage.reservedModelTurns &&
      !task.usage.reservedToolCalls &&
      !task.operations.some((operation) =>
        ["unknown", "planned"].includes(operation.status),
      ) &&
      coordinator.workspaces.link(task.id)?.cleaned
    ) {
      try {
        task = coordinator.repository.update(
          task.id,
          { kind: "resume" },
          {
            ownerId: task.ownerId,
            expectedRevision: task.revision,
            now,
            claim: null,
          },
        );
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 429) throw error;
        continue; // Keep the retry until active-task capacity becomes available.
      }
    }
    if (
      task.state !== "queued" ||
      task.nextRunAt > now ||
      coordinator.awaiting(task.id)
    )
      continue;
    const claimed = coordinator.repository.update(
      task.id,
      { kind: "claim", claimId: randomId(), leaseMs: coordinator.leaseMs() },
      {
        ownerId: task.ownerId,
        expectedRevision: task.revision,
        now,
        claim: null,
      },
    );
    const tools =
      claimed.stepId === "validate" ||
      (claimed.stepId === "build" &&
        coordinator.builders.stage(claimed.id) !== "model");
    let code = null;
    if (
      claimed.operations.some((operation) =>
        ["unknown", "planned"].includes(operation.status),
      ) ||
      claimed.usage.reservedModelTurns ||
      claimed.usage.reservedToolCalls
    )
      code = "reconciliation_required";
    else if (
      !["plan", "build", "validate"].includes(claimed.stepId) ||
      (claimed.stepId === "validate" && !coordinator.validationAvailable()) ||
      (claimed.stepId === "build" && !coordinator.workspaceProvider()) ||
      (!tools && !coordinator.plannerAvailable())
    )
      code = "provider_unavailable";
    else if (!tools && claimed.usage.modelTurns >= TASK_LIMITS.modelTurns)
      code = "budget_exceeded";
    if (code) {
      coordinator.repository.update(
        claimed.id,
        { kind: "fail", failure: { code, stepId: claimed.stepId } },
        {
          ownerId: claimed.ownerId,
          expectedRevision: claimed.revision,
          now,
          claim: { id: claimed.claim.id, generation: claimed.generation },
        },
      );
      continue;
    }
    return claimed;
  }
  return null;
}
