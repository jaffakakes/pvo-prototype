import { parseDraftTestResults } from "../../../packages/pvo-assistant/results/index.js";
import { HttpError } from "../../http.js";

/** The authenticated coordinator supplies the owned task; guest output is diagnostics only. */
export function draftTestResults(coordinator, task) {
  const state = coordinator.drafts.get(task.id);
  if (!task.input.context.container || !state)
    throw new HttpError(404, "This Container task is unavailable.");
  const builder = coordinator.builders.get(task.id);
  const saved = coordinator.artifacts.get(task.id, builder.round);
  const result = builder.feedback.findLast(
    (row) => row.kind === "workspace_test",
  )?.result;
  return parseDraftTestResults({
    ownerId: task.ownerId,
    taskId: task.id,
    serviceId: state.draft.identity.serviceId,
    revision:
      state.testingRevision === null
        ? state.draft.revision
        : state.testingRevision,
    agreement: saved?.artifact.agreement ?? state.draft.content.agreement,
    generated:
      result?.kind === "command" && result.status === "completed"
        ? result.result
        : null,
    report: saved?.report ?? null,
  });
}
