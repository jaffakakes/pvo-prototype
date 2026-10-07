import { reviewProgressEvidence } from "../tasks/progressEvidence.js";
import {
  SERVICE_TEST_LIMITS,
  SERVICE_TEST_POLICY,
  serializeServicePackage,
} from "../../../packages/pvo-assistant/services/index.js";
import { builderReviewRequest } from "../../../packages/pvo-assistant/builder/index.js";
import { prepareWorkspaceIdentity } from "../workspaces/identity.js";
import { contentDigest } from "../../contentDigest.js";
import { withAssistantDeadline } from "../deadline.js";
import {
  hasCurrentClaim,
  taskClaim,
  transitionGuard,
} from "../tasks/executionClaim.js";
import { prepareServiceArtifact } from "./artifact.js";

function checkpoint(coordinator, claimed, stepId) {
  const task = coordinator.validation.task(claimed.id),
    now = coordinator.now();
  if (!hasCurrentClaim(task, claimed, now)) return;
  coordinator.repository.update(
    task.id,
    { kind: "checkpoint", stepId },
    transitionGuard(task, now, taskClaim(task)),
  );
}

function completeReport(coordinator, claimed, state, report, error = null) {
  if (
    report?.status === "passed" &&
    !coordinator.artifacts.verified(claimed.id, state.round)
  )
    throw new Error(
      "A passing report must refer to the task's saved artifact.",
    );
  if (
    !coordinator.builders.review(
      claimed,
      { review: builderReviewRequest(state), report, error },
      coordinator.now(),
    )
  )
    return;
  coordinator.progress.observe(
    coordinator.validation.task(claimed.id),
    "reviews",
    state.round,
    reviewProgressEvidence(state, report, error),
  );
  checkpoint(
    coordinator,
    claimed,
    report?.status === "passed"
      ? claimed.input.context.container
        ? "draft_sync"
        : "host"
      : "build",
  );
}

async function fail(coordinator, claimed, code) {
  await coordinator.transaction(() => {
    const task = coordinator.validation.task(claimed.id),
      now = coordinator.now();
    if (hasCurrentClaim(task, claimed, now))
      coordinator.repository.update(
        task.id,
        { kind: "fail", failure: { code, stepId: "validate" } },
        transitionGuard(task, now, taskClaim(task)),
      );
  });
}

/** One durable capture or test step per claim. No generated code sees test expectations or report authority. */
export async function runServiceValidation(coordinator, claimed) {
  const state = coordinator.builders.get(claimed.id),
    review = builderReviewRequest(state);
  if (!review || coordinator.builders.stage(claimed.id) !== "review") {
    await fail(coordinator, claimed, "invalid_result");
    return;
  }
  const saved = coordinator.artifacts.get(claimed.id, state.round);
  if (saved && saved.report.status !== "running") {
    await coordinator.transaction(() =>
      completeReport(coordinator, claimed, state, saved.report),
    );
    return;
  }
  const input = saved
    ? {
        kind: "step",
        policy: SERVICE_TEST_POLICY,
        round: state.round,
        identity: saved.artifact.identity,
        index: saved.report.cases.length,
        step: saved.cursor.step,
      }
    : {
        kind: "capture",
        policy: SERVICE_TEST_POLICY,
        round: state.round,
        agreementDigest: state.agreement.digest,
        review,
      };
  const inputDigest = await contentDigest(JSON.stringify(input));
  const row = await coordinator.transaction(() =>
    coordinator.validation.begin(
      claimed,
      input,
      inputDigest,
      coordinator.now(),
    ),
  );
  if (!row) return;
  const controller = new AbortController();
  coordinator.active.set(claimed.id, controller);
  try {
    let artifact = null,
      result = null,
      artifactError = false,
      unavailable = false,
      wait = null;
    try {
      await withAssistantDeadline(
        async (signal) => {
          signal.throwIfAborted();
          if (
            !hasCurrentClaim(
              coordinator.validation.task(claimed.id),
              claimed,
              coordinator.now(),
            )
          )
            throw new Error("Validation claim ended.");
          if (saved) {
            result = await coordinator.runValidationStep(
              saved.artifact,
              input.index,
              saved.cursor,
              signal,
            );
            return;
          }
          const identity = await prepareWorkspaceIdentity(claimed);
          const observation = await coordinator
            .workspaceProvider()
            .lookup(identity);
          signal.throwIfAborted();
          // A missing/mismatched snapshot is a concrete source failure; a failed lookup is unavailable.
          try {
            artifact = await prepareServiceArtifact(state, observation?.source);
          } catch {
            artifactError = true;
          }
        },
        Math.max(
          1,
          Math.min(
            SERVICE_TEST_LIMITS.stepMs + 1000,
            row.deadlineAt - coordinator.now(),
          ),
        ),
        controller.signal,
      );
    } catch (error) {
      unavailable = true;
      if (
        !controller.signal.aborted &&
        [
          "execution_capacity",
          "execution_allowance",
          "cleanup_unconfirmed",
          "startup_timeout",
        ].includes(error?.code)
      )
        wait = {
          kind: "wait",
          reason:
            error.code === "execution_allowance"
              ? "service_allowance"
              : "service_capacity",
          nextRunAt: Math.max(
            coordinator.now() + 1000,
            Number.isSafeInteger(error.retryAt)
              ? error.retryAt
              : coordinator.now() + 60000,
          ),
        };
    }
    await coordinator.transaction(() => {
      const outcome = unavailable
        ? "interrupted"
        : artifactError ||
            (saved &&
              result?.caseResult &&
              result.caseResult.status !== "passed")
          ? "failed"
          : "completed";
      if (
        !coordinator.validation.finish(
          row.id,
          outcome,
          coordinator.now(),
          artifact && !unavailable
            ? {
                id: `package-${artifact.identity.packageDigest}`,
                sha256: artifact.identity.packageDigest,
                bytes: new TextEncoder().encode(
                  serializeServicePackage(artifact.package),
                ).length,
              }
            : null,
        )
      )
        return;
      if (unavailable) {
        const task = coordinator.validation.task(claimed.id);
        coordinator.repository.update(
          task.id,
          wait ?? {
            kind: "fail",
            failure: { code: "execution_failed", stepId: "validate" },
          },
          transitionGuard(task, coordinator.now(), taskClaim(task)),
        );
      } else if (artifactError) {
        completeReport(
          coordinator,
          claimed,
          state,
          null,
          "The exact saved source, entry point, tests or agreement digest did not match the requested package. Read the saved files and request review of their actual revision and digest.",
        );
      } else if (artifact) {
        coordinator.artifacts.save(claimed.id, state.round, artifact);
        checkpoint(coordinator, claimed, "validate");
      } else {
        const next = coordinator.artifacts.advance(
          claimed.id,
          state.round,
          result,
        );
        if (next.report.status === "running")
          checkpoint(coordinator, claimed, "validate");
        else completeReport(coordinator, claimed, state, next.report);
      }
    });
  } finally {
    if (coordinator.active.get(claimed.id) === controller)
      coordinator.active.delete(claimed.id);
  }
}
