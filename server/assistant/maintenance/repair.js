import {
  parseRepairDiagnosis,
  repairEvidence,
  requireRepairEdit,
} from "../../../packages/pvo-assistant/maintenance/index.js";
import { canonicalJson } from "../../../packages/pvo-assistant/services/json.js";
import { requireTask } from "../../../packages/pvo-assistant/tasks/validation.js";
import { transitionGuard, taskClaim } from "../tasks/executionClaim.js";

export function baselineRunning(coordinator, task) {
  return coordinator.drafts.get(task.id)?.maintenance?.phase === "baseline";
}
/** Completed trusted checks, including failures, return to diagnosis without hosting or saving source. */
export function finishRepairBaseline(
  coordinator,
  claimed,
  report,
  generated = null,
) {
  const state = coordinator.drafts.get(claimed.id);
  if (state?.maintenance?.phase !== "baseline") return false;
  if (!report && !generated) return false;
  state.maintenance.baseline = {
    status: report?.status ?? (generated.exitCode === 0 ? "passed" : "failed"),
    report,
    generated,
  };
  state.maintenance.phase = "diagnose";
  coordinator.drafts.write(claimed.id, state);
  const task = coordinator.builders.task(claimed.id);
  coordinator.repository.update(
    task.id,
    { kind: "checkpoint", stepId: "plan" },
    transitionGuard(task, coordinator.now(), taskClaim(task)),
  );
  return true;
}
export function acceptRepairDecision(state, decision) {
  if (!state.maintenance) {
    requireTask(
      decision.kind !== "diagnose",
      "Start an investigation before diagnosing a fault.",
    );
    return;
  }
  const maintenance = state.maintenance;
  if (decision.kind === "diagnose")
    maintenance.diagnosis = parseRepairDiagnosis(
      decision,
      repairEvidence(maintenance),
    );
  if (["write", "replace"].includes(decision.kind)) {
    requireRepairEdit(state);
    requireTask(
      state.read?.revision === state.draft.revision && !state.read.published,
      "Read current saved source before editing it.",
    );
    if (decision.kind === "write")
      requireTask(
        canonicalJson(JSON.parse(decision.agreementJson)) ===
          canonicalJson(maintenance.agreement),
        "A repair must preserve the agreed behavior. Start a normal edit task for a behavior change.",
      );
  }
  if (decision.kind === "done") {
    requireTask(
      !!maintenance.diagnosis,
      "Diagnose the failing stage before reporting an outcome.",
    );
    requireTask(
      maintenance.diagnosis.stage !== "backend_rule" ||
        maintenance.verifiedRevision === state.draft.revision,
      "A backend repair requires fresh independent checks and a checked version before completion.",
    );
  }
  if (decision.kind === "execute" && maintenance.phase !== "baseline") {
    requireRepairEdit(state);
    const tests = state.draft.content.tests;
    requireTask(
      tests.some(
        (path) =>
          state.draft.content.files.find((file) => file.path === path)
            ?.content !==
          maintenance.tests.find((file) => file.path === path)?.content,
      ),
      "Add a meaningful regression test before checking the repaired code.",
    );
    if (maintenance.phase === "diagnose") {
      maintenance.phase = "countercheck";
      maintenance.regression = null;
    }
  }
}
export function requireRepairArtifact(coordinator, task, artifact) {
  const state = coordinator.drafts.get(task.id);
  if (!state?.maintenance || state.maintenance.phase === "baseline") return;
  requireTask(
    state.maintenance.regression?.status === "reproduced",
    "The regression must first fail against the original code.",
  );
  requireTask(
    artifact.package.tests.some(
      (path) =>
        artifact.package.files.find((file) => file.path === path)?.content !==
        state.maintenance.tests.find((file) => file.path === path)?.content,
    ),
    "A checked repair needs a regression test in the actual artifact.",
  );
  requireTask(
    canonicalJson(artifact.agreement) ===
      canonicalJson(state.maintenance.agreement),
    "A repair cannot weaken the original independent behavior cases.",
  );
}
export function repairReport(state) {
  const maintenance = state.maintenance;
  if (!maintenance) return null;
  const diagnosis = maintenance.diagnosis;
  const verified = maintenance.verifiedRevision === state.draft.revision;
  return {
    stage: diagnosis?.stage ?? "unknown",
    summary: diagnosis?.summary ?? "Investigation is unfinished.",
    baseline: maintenance.baseline?.status ?? "unrun",
    regression: maintenance.regression?.status ?? "unrun",
    checkedRevision: maintenance.verifiedRevision ?? null,
    published: false,
    outcome: verified
      ? "Checked repair saved. Refresh Containers to review and publish it."
      : "No code repair has been verified. Resolve the observed dependency and check the same original action.",
    dependencies: repairEvidence(maintenance)
      .filter((item) => !verified && diagnosis?.evidenceKeys.includes(item.key))
      .map(({ message, recovery }) => ({ message, recovery })),
    observedAt: maintenance.snapshot.observedAt,
  };
}
