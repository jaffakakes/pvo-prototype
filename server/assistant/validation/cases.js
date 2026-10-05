import {
  parseServiceAgreement,
  parseServiceInvocation,
  matchServicePackage,
  parseServiceCaseResult,
  inspectServiceReply,
  SERVICE_TEST_LIMITS,
} from "../../../packages/pvo-assistant/services/index.js";
import { withAssistantDeadline } from "../deadline.js";
import { executeServicePackage } from "../../cloud-services/packageExecution.js";

/** Expected values and comparison authority never cross into generated code. */
export async function runServiceCase(
  loader,
  source,
  agreement,
  agreementDigest,
  index,
  signal,
) {
  agreement = parseServiceAgreement(agreement);
  source = matchServicePackage(source, agreementDigest);
  const scenario = agreement.cases[index];
  if (!Number.isSafeInteger(index) || !scenario)
    throw new Error("Unknown service behavior case.");
  let state = structuredClone(scenario.initialState),
    completedSteps = 0;
  const failed = (code, detail) =>
    parseServiceCaseResult(
      {
        id: scenario.id,
        status: code === "interrupted" ? "interrupted" : "failed",
        // If a deadline wins the final promise race, discard that last step conservatively.
        completedSteps: Math.min(completedSteps, scenario.steps.length - 1),
        failure: {
          step: Math.min(completedSteps, scenario.steps.length - 1),
          code,
          detail,
        },
      },
      scenario,
    );
  try {
    return await withAssistantDeadline(
      async (current) => {
        for (const step of scenario.steps) {
          current.throwIfAborted();
          const invocation = parseServiceInvocation(agreement, {
            operation: step.operation,
            input: step.input,
            state,
            now: step.now,
          });
          const reply = await executeServicePackage(
            loader,
            source,
            invocation,
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
          state = reply.state;
          completedSteps++;
        }
        return parseServiceCaseResult(
          { id: scenario.id, status: "passed", completedSteps, failure: null },
          scenario,
        );
      },
      SERVICE_TEST_LIMITS.caseMs,
      signal,
    );
  } catch (error) {
    if (signal?.aborted)
      return failed(
        "interrupted",
        "Validation was interrupted before this case completed.",
      );
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
