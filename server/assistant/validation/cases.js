import {
  parseServiceAgreement,
  parseServiceInvocation,
  parseServiceState,
  matchServicePackage,
  parseServiceCaseResult,
  inspectServiceReply,
  SERVICE_TEST_LIMITS,
} from "../../../packages/pvo-assistant/services/index.js";
import { withAssistantDeadline } from "../deadline.js";
import { executeServicePackage } from "../../cloud-services/packageExecution.js";

/** One isolated step. Its checked state is checkpointed before the next guest starts. */
export async function runServiceStep(
  namespace,
  source,
  agreement,
  agreementDigest,
  index,
  cursor,
  scope,
  signal,
) {
  agreement = parseServiceAgreement(agreement);
  source = matchServicePackage(source, agreementDigest);
  const scenario = agreement.cases[index];
  if (
    !Number.isSafeInteger(index) ||
    !scenario ||
    !Number.isSafeInteger(cursor?.step) ||
    !scenario.steps[cursor.step]
  )
    throw new Error("Unknown service behavior step.");
  const state = parseServiceState(agreement, cursor.state),
    stepIndex = cursor.step,
    step = scenario.steps[stepIndex];
  const observation = (caseResult, state = null) => ({
    index,
    step: stepIndex,
    caseResult,
    state,
  });
  const failed = (code, detail) =>
    observation(
      parseServiceCaseResult(
        {
          id: scenario.id,
          status: code === "interrupted" ? "interrupted" : "failed",
          completedSteps: stepIndex,
          failure: { step: stepIndex, code, detail },
        },
        scenario,
      ),
    );
  try {
    return await withAssistantDeadline(
      async (current) => {
        current.throwIfAborted();
        const invocation = parseServiceInvocation(agreement, {
          operation: step.operation,
          input: step.input,
          state,
          now: step.now,
        });
        const reply = await executeServicePackage(
          namespace,
          source,
          invocation,
          scope,
          current,
        );
        current.throwIfAborted();
        const problem = inspectServiceReply(
          agreement,
          invocation,
          step.expected,
          reply,
        );
        if (problem) return failed(problem.code, problem.detail);
        if (stepIndex + 1 < scenario.steps.length)
          return observation(null, reply.state);
        return observation(
          parseServiceCaseResult(
            {
              id: scenario.id,
              status: "passed",
              completedSteps: scenario.steps.length,
              failure: null,
            },
            scenario,
          ),
        );
      },
      SERVICE_TEST_LIMITS.stepMs,
      signal,
    );
  } catch (error) {
    if (signal?.aborted)
      return failed(
        "interrupted",
        "Validation was interrupted before this step completed.",
      );
    // Capacity is not evidence that source behavior failed. The task runner preserves this step.
    if (
      [
        "execution_capacity",
        "execution_allowance",
        "cleanup_unconfirmed",
        "runtime_unavailable",
        "startup_timeout",
      ].includes(error?.code)
    )
      throw error;
    if (error?.status === 504 || error?.name === "TimeoutError")
      return failed(
        "timeout",
        "Generated code exceeded the validation time limit.",
      );
    const code = ["invalid_reply", "output_limit"].includes(error?.code)
      ? error.code
      : "execution_failed";
    return failed(
      code,
      code === "output_limit"
        ? "Generated code exceeded the reply byte limit."
        : "Generated code did not return a valid bounded reply.",
    );
  }
}
