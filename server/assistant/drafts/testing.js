import { prepareDraftResponse } from "./authoring.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";

/** Select the existing builder tools for a frozen manual draft, without inference or source edits. */
export async function runDraftTestPreparation(coordinator, claimed) {
  const commit = (apply) =>
    coordinator.transaction(() => {
      const task = coordinator.builders.task(claimed.id),
        now = coordinator.now();
      if (hasCurrentClaim(task, claimed, now))
        apply(task, transitionGuard(task, now, taskClaim(task)));
    });
  try {
    if (claimed.stepId === "plan") {
      const prepared = await prepareDraftResponse(coordinator, claimed, {
        kind: "execute",
        reason:
          "Run the saved draft's selected tests, then independently check its agreed behavior.",
      });
      await commit((task, guard) => {
        coordinator.drafts.write(task.id, prepared.draftState);
        coordinator.builders.write(task.id, prepared.builder);
        coordinator.repository.update(task.id, prepared.command, guard);
      });
      return;
    }
    if (claimed.stepId !== "build")
      throw new Error("Unexpected manual test step.");
    const state = coordinator.builders.get(claimed.id);
    const failedTest = state.feedback.findLast(
      (row) => row.kind === "workspace_test",
    );
    if (
      failedTest?.result?.kind === "command" &&
      failedTest.result.status === "completed" &&
      failedTest.result.result?.exitCode !== 0
    ) {
      await commit((task, guard) =>
        coordinator.repository.update(
          task.id,
          { kind: "fail", failure: { code: "tests_failed", stepId: "build" } },
          guard,
        ),
      );
      return;
    }
    const write = state.feedback.findLast(
      (row) => row.kind === "workspace_write",
    );
    if (write?.result?.status !== "completed" || !write.result.result)
      throw new Error("The frozen draft has not been restored.");
    const { revision, digest } = write.result.result;
    const { entrypoint, tests } = coordinator.drafts.get(claimed.id).draft
      .content;
    // A recovered/interrupted batch starts a new owned workshop from the same saved bytes.
    // Unknown effects and old-computer cleanup are reconciled by the existing task scheduler.
    const decision = {
      kind: "tools",
      calls: [
        { kind: "workspace_start", revision, digest },
        { kind: "workspace_test", revision, digest, paths: tests },
      ],
      review: { kind: "review", revision, digest, entrypoint, tests },
    };
    await commit((task, guard) => {
      const prepared = coordinator.builders.prepare(
        claimed,
        decision,
        null,
        coordinator.now(),
      );
      if (!prepared) return;
      coordinator.builders.write(task.id, prepared.state);
      coordinator.repository.update(task.id, prepared.command, guard);
    });
  } catch {
    await commit((task, guard) =>
      coordinator.repository.update(
        task.id,
        {
          kind: "fail",
          failure: { code: "execution_failed", stepId: claimed.stepId },
        },
        guard,
      ),
    );
  }
}
