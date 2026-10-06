import { canonicalJson } from "../services/json.js";
import {
  prepareServiceSubmission,
  parseServiceSubmissionTarget,
  snapshotSubmissionInput,
  retryServiceSubmission,
  completeServiceSubmission,
  serviceSubmissionRequest,
} from "./submissions.js";

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}
function assertCurrent(context) {
  if (context.signal?.aborted || !context.isCurrent()) {
    throw Object.assign(
      new Error("The component interaction is no longer active."),
      { name: "AbortError" },
    );
  }
}

/** Store updates must be atomic across clients, and resolve only after their transaction commits. */
export function createServiceSubmissionClient({ store, createId, send }) {
  async function dispatch(slot, saved, context) {
    assertCurrent(context);
    if (saved.response !== null) return saved;
    // An exception, timeout or invalid response leaves the already persisted intent available for retry.
    const response = await send(
      serviceSubmissionRequest(saved),
      context.signal,
    );
    const completed = await store.update(slot, (value) => {
      if (value === null)
        throw failure(
          "submission_changed",
          "The saved submission is no longer available.",
        );
      const current = retryServiceSubmission(value, saved.target);
      if (canonicalJson(current.action) !== canonicalJson(saved.action)) {
        throw failure(
          "submission_changed",
          "A newer submission is already saved.",
        );
      }
      // Bookkeeping may settle its own record after cancellation, but cannot overwrite another action.
      return completeServiceSubmission(current, response);
    });
    assertCurrent(context);
    return completed;
  }

  return {
    async submit(slot, target, input, context) {
      assertCurrent(context);
      const captured = snapshotSubmissionInput(target, input);
      target = captured.target;
      input = captured.input;
      const saved = await store.update(slot, (value) => {
        assertCurrent(context);
        if (value !== null) {
          const previous = retryServiceSubmission(value, target);
          if (previous.response === null) {
            const candidate = prepareServiceSubmission(
              target,
              input,
              previous.action.actionId,
            );
            if (
              canonicalJson(candidate.action) !== canonicalJson(previous.action)
            ) {
              throw failure(
                "submission_pending",
                "A previous submission still needs its result. Retry it before sending different input.",
              );
            }
            return previous;
          }
          const next = prepareServiceSubmission(target, input, createId());
          if (next.action.actionId === previous.action.actionId) {
            throw failure(
              "invalid_action_id",
              "A new submission needs a new action identity.",
            );
          }
          return next;
        }
        return prepareServiceSubmission(target, input, createId());
      });
      return dispatch(slot, saved, context);
    },
    async retry(slot, target, context, expectedActionId) {
      assertCurrent(context);
      target = parseServiceSubmissionTarget(target);
      const value = await store.read(slot);
      if (value === null)
        throw failure(
          "submission_missing",
          "There is no saved submission to retry.",
        );
      const saved = retryServiceSubmission(value, target);
      if (
        expectedActionId !== undefined &&
        saved.action.actionId !== expectedActionId
      )
        throw failure(
          "submission_changed",
          "A newer submission is saved. Open its recovery option again.",
        );
      return dispatch(slot, saved, context);
    },
  };
}
