import { prepareDraftResponse } from "../drafts/authoring.js";

/** Countercheck uses the original implementation plus the proposed regression files, never live data or accounts. */
export async function prepareRegressionContinuation(
  coordinator,
  task,
  builder,
) {
  const state = coordinator.drafts.get(task.id);
  if (state.maintenance?.phase !== "countercheck") return null;
  const test = builder.feedback.findLast(
    (row) => row.kind === "workspace_test",
  )?.result;
  if (test?.kind !== "command" || test.status !== "completed") return null;
  state.maintenance.regression = {
    status: test.result.exitCode === 0 ? "not_reproduced" : "reproduced",
    generated: test.result,
  };
  if (test.result.exitCode === 0) {
    state.maintenance.phase = "diagnose";
    return {
      draftState: state,
      builder: null,
      command: { kind: "checkpoint", stepId: "plan" },
    };
  }
  // Persisted source remains the repaired draft. Only the workshop snapshot changes here.
  state.maintenance.phase = "verify";
  return prepareDraftResponse(
    coordinator,
    task,
    {
      kind: "execute",
      reason:
        "The regression failed against original source. Check it and all independent cases against the repaired draft.",
    },
    state,
  );
}
