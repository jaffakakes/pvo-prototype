import { parseBuilderDecision } from "../../../packages/pvo-assistant/builder/index.js";
import { serializeServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";
import { contentDigest } from "../../contentDigest.js";

/** Hash the exact saved decision context before reserving an inference. */
export function authoringInput(coordinator, task) {
  return {
    input: task.input,
    questions: task.questions,
    stepId: task.stepId,
    ...(task.stepId === "build"
      ? { build: coordinator.builders.context(task.id) }
      : {}),
  };
}

export async function prepareAuthoringResponse(
  coordinator,
  task,
  response,
  input,
) {
  if (task.stepId !== "build") return response;
  try {
    const decision = parseBuilderDecision(response, {
      hasAgreement: input.build.agreement !== null,
      available: coordinator
        .workspaceToolDefinitions()
        .map((tool) => tool.kind),
    });
    const agreementDigest =
      decision.kind === "agreement"
        ? await contentDigest(serializeServiceAgreement(decision.agreement))
        : null;
    return { decision, agreementDigest };
  } catch {
    throw Object.assign(new Error("Invalid saved builder response."), {
      code: "invalid_result",
    });
  }
}

/** The caller commits the inference receipt, validated decision and task transition together. */
export function finishAuthoringAttempt(
  coordinator,
  claimed,
  attempt,
  response,
  code,
  now,
) {
  let prepared = null;
  if (
    !code &&
    claimed.stepId === "build" &&
    coordinator.attempts.current(claimed, now)
  ) {
    try {
      prepared = coordinator.builders.prepare(
        claimed,
        response.decision,
        response.agreementDigest,
        now,
      );
    } catch {
      code = "invalid_result";
    }
  }
  const accepted = coordinator.attempts.finish(
    claimed,
    attempt,
    claimed.stepId === "build" ? prepared?.command : response,
    code,
    now,
  );
  if (accepted && prepared)
    coordinator.builders.write(claimed.id, prepared.state);
}
