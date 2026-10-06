import { parseBuilderDecision } from "../../../packages/pvo-assistant/builder/index.js";
import { serializeServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";
import { attachmentPlanningContext } from "../attachments/context.js";
import { prepareTaskAttachment } from "../attachments/preparation.js";
import { contentDigest } from "../../contentDigest.js";

/** Hash the exact saved decision context before reserving an inference. */
export function authoringInput(coordinator, task) {
  return {
    input: task.input,
    questions: task.questions,
    evidence: coordinator.evidence.context(task),
    stepId: task.stepId,
    ...(task.stepId === "attach"
      ? { attachment: attachmentPlanningContext(coordinator, task) }
      : {}),
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
  if (response?.kind === "history") {
    try {
      return {
        evidence: coordinator.evidence.select(task, response),
        command: { kind: "checkpoint", stepId: task.stepId },
      };
    } catch {
      throw Object.assign(new Error("Invalid evidence selection."), {
        code: "invalid_result",
      });
    }
  }
  if (task.stepId === "attach") {
    try {
      return await prepareTaskAttachment(coordinator, task, response);
    } catch {
      throw Object.assign(new Error("Invalid saved component attachment."), {
        code: "invalid_result",
      });
    }
  }
  if (task.stepId !== "build") return response;
  try {
    const decision = parseBuilderDecision(response, {
      hasAgreement: input.build.agreement !== null,
      available: coordinator.builderToolDefinitions().map((tool) => tool.kind),
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
    !response?.evidence &&
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
  let command = response;
  if (response?.evidence) command = response.command;
  else if (claimed.stepId === "build") command = prepared?.command;
  else if (claimed.stepId === "attach") command = response?.command;
  const accepted = coordinator.attempts.finish(
    claimed,
    attempt,
    command,
    code,
    now,
  );
  if (accepted && response?.evidence)
    coordinator.evidence.save(claimed.id, response.evidence);
  if (accepted && !response?.evidence && claimed.stepId === "attach")
    coordinator.results.save(
      coordinator.attempts.task(claimed.id),
      response.encoded,
    );
  if (accepted && prepared)
    coordinator.builders.write(claimed.id, prepared.state);
}
