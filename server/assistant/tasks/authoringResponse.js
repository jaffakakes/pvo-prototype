import { taskClaim, transitionGuard } from "./executionClaim.js";
import { transitionTask } from "../../../packages/pvo-assistant/tasks/index.js";
import { AuthoringRepairError } from "./repairFeedback.js";
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
    evidence: {
      ...coordinator.evidence.context(task),
      repair: coordinator.repairs.context(task),
      progress: coordinator.progress.context(task),
    },
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
      throw new AuthoringRepairError(
        "history_selection",
        "Choose a valid collection and cursor from the saved history instructions.",
        response,
      );
    }
  }
  if (task.stepId === "attach") {
    try {
      return await prepareTaskAttachment(coordinator, task, response);
    } catch (error) {
      if (error instanceof AuthoringRepairError) throw error;
      throw new AuthoringRepairError(
        "attachment_evidence",
        "The proposed connection could not be matched to current owned, independently checked hosting evidence. Use the exact supplied release and operation.",
        response,
      );
    }
  }
  if (task.stepId !== "build") {
    try {
      if (!["ask", "checkpoint"].includes(response?.kind))
        throw new Error("Return a question or build checkpoint.");
      if (
        response.kind === "checkpoint" &&
        !["plan", "build"].includes(response.stepId)
      )
        throw new Error("Planning can only advance to build.");
      transitionTask(task, response, {
        ownerId: task.ownerId,
        expectedRevision: task.revision,
        now: task.updatedAt,
        claim: { id: task.claim.id, generation: task.generation },
      });
      return response;
    } catch {
      throw new AuthoringRepairError(
        "planning_response",
        "Return a valid question or build decision using the supplied JSON schema.",
        response,
      );
    }
  }
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
  } catch (error) {
    throw new AuthoringRepairError("builder_response", error.message, response);
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
  wait = null,
  feedback = null,
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
    } catch (error) {
      code = "invalid_result";
      feedback = new AuthoringRepairError(
        "builder_state",
        error.message,
        response.decision,
      ).feedback;
    }
  }
  let command = response;
  if (response?.evidence) command = response.command;
  else if (claimed.stepId === "build") command = prepared?.command;
  else if (claimed.stepId === "attach") command = response?.command;
  const repair =
    code === "invalid_result" &&
    feedback &&
    !wait &&
    coordinator.attempts.current(claimed, now)
      ? coordinator.repairs.prepare(
          coordinator.attempts.task(claimed.id),
          attempt,
          feedback,
          now,
        )
      : null;
  const result = coordinator.attempts.finish(
    claimed,
    attempt,
    command,
    code,
    now,
    wait,
    repair?.command ?? null,
  );
  if (result?.repaired) coordinator.repairs.save(claimed.id, repair.record);
  const accepted = result?.accepted;
  if (accepted && !response?.evidence) {
    coordinator.repairs.clear(claimed.id);
    coordinator.progress.clear(claimed.id, "history");
  }
  if (accepted && response?.evidence) {
    coordinator.evidence.save(claimed.id, response.evidence);
    const { notes: _notes, ...selection } = response.evidence;
    coordinator.progress.observe(claimed, "history", claimed.generation, {
      stepId: claimed.stepId,
      selection,
    });
  }
  if (accepted && !response?.evidence && claimed.stepId === "attach")
    coordinator.results.save(
      coordinator.attempts.task(claimed.id),
      response.encoded,
    );
  if (accepted && prepared)
    coordinator.builders.write(claimed.id, prepared.state);
}

/** Request help before another inference when saved execution has repeated the same evidence unchanged. */
export function askForProgressHelp(coordinator, claimed) {
  const now = coordinator.now();
  if (!coordinator.attempts.current(claimed, now)) return false;
  const task = coordinator.attempts.task(claimed.id);
  const round =
    task.stepId === "build" ? coordinator.builders.get(task.id).round : null;
  const question = coordinator.progress.question(task, round);
  if (!question) return false;
  coordinator.repository.update(
    task.id,
    { kind: "ask", question },
    transitionGuard(task, now, taskClaim(task)),
  );
  return true;
}
