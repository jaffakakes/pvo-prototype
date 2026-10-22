import { TaskEvidence } from "../../../server/assistant/tasks/evidence.js";

/** Reuse the app's bounded selection contract over the evaluation's saved records. */
export function selectBuildHistory(decision, task, state, row, workspace) {
  const entries = {
    input: [task.input],
    agreement: [state.agreement],
    questions: task.questions,
    operations: row.operations ?? [],
    research: [],
    workspace: row.operations ?? [],
    reviews: row.reviews.map((review) => review.feedback),
    repairs: row.repairs ?? [],
  }[decision.collection];
  // Workspace history contains receipts. Current source remains available via workspace_read.
  const index = decision.after;
  const entry =
    entries[index] === undefined
      ? null
      : { sequence: index + 1, value: entries[index] };
  const selection = TaskEvidence.prototype.select.call(
    { entry: () => entry },
    task,
    decision,
  );
  const signature = JSON.stringify({
    collection: selection.collection,
    sequence: selection.sequence,
    offset: selection.offset,
    content: selection.content,
    source: workspace?.digest ?? null,
  });
  const prior = row.historyProgress;
  row.historyProgress = {
    signature,
    repetitions: prior?.signature === signature ? prior.repetitions + 1 : 1,
  };
  return {
    selection,
    notes: decision.notes,
    progress: [
      {
        channel: "history",
        round: row.decisions.length,
        repetitions: row.historyProgress.repetitions,
      },
    ],
  };
}
