import {
  choice,
  id,
  list,
  object,
  requireTask,
  text,
  time,
  unique,
} from "./validation.js";
import { TASK_LIMITS } from "./limits.js";

export const ACCEPT_ALTERNATIVE = "Use this alternative";
export const DECLINE_ALTERNATIVE = "Keep my original request";

/** A proposal changes the promised outcome, never grants an external effect. */
export function parseManualAlternative(value) {
  object(
    value,
    [
      "capabilityId",
      "originalOutcome",
      "preparedOutcome",
      "limitation",
      "notice",
      "fields",
      "steps",
    ],
    "Manual alternative",
  );
  id(value.capabilityId, "Capability receipt");
  for (const key of [
    "originalOutcome",
    "preparedOutcome",
    "limitation",
    "notice",
  ])
    text(value[key], 1000, "Alternative explanation");
  requireTask(
    value.originalOutcome !== value.preparedOutcome,
    "Explain the changed outcome.",
  );
  list(value.fields, 8, "Alternative fields");
  for (const field of value.fields) {
    object(field, ["name", "kind", "label", "purpose"], "Alternative field");
    requireTask(
      typeof field.name === "string" &&
        /^[a-z][a-z0-9_]{0,31}$/.test(field.name),
      "Use a lowercase field name.",
    );
    choice(
      field.kind,
      ["name", "email", "phone", "short", "number", "yesno"],
      "Form field kind",
    );
    text(field.label, 100, "Field label");
    text(field.purpose, 240, "Collected data purpose");
  }
  unique(
    value.fields.map((item) => item.name),
    "Alternative field names",
  );
  list(value.steps, 8, "Manual steps");
  requireTask(
    value.steps.length > 0,
    "Explain what a person still needs to do.",
  );
  for (const step of value.steps) {
    object(step, ["id", "instruction"], "Manual step");
    id(step.id, "Manual step ID");
    text(step.instruction, 1000, "Manual instruction");
  }
  unique(
    value.steps.map((item) => item.id),
    "Manual step IDs",
  );
  return structuredClone(value);
}

export function validateManualPlans(plans, createdAt, updatedAt) {
  list(plans, 8, "Saved alternatives");
  unique(
    plans.map((item) => item.questionId),
    "Alternative question IDs",
  );
  unique(
    plans.map((item) => item.proposal.capabilityId),
    "Chosen alternatives",
  );
  for (const plan of plans) {
    object(
      plan,
      ["questionId", "acceptedAt", "proposal", "steps"],
      "Saved alternative",
    );
    id(plan.questionId, "Alternative question ID");
    time(plan.acceptedAt, "Alternative choice time");
    requireTask(
      plan.acceptedAt >= createdAt && plan.acceptedAt <= updatedAt,
      "Alternative time is outside the task.",
    );
    parseManualAlternative(plan.proposal);
    list(plan.steps, 8, "Manual follow-up");
    requireTask(
      plan.steps.length === plan.proposal.steps.length,
      "Preserve every agreed manual step.",
    );
    plan.steps.forEach((step, index) => {
      object(step, ["id", "resolution"], "Manual follow-up");
      requireTask(
        step.id === plan.proposal.steps[index].id,
        "Manual steps must match the accepted proposal.",
      );
      if (step.resolution !== null) {
        const result = step.resolution;
        object(
          result,
          ["operationId", "status", "note", "resolvedAt"],
          "Manual resolution",
        );
        validateResolution(result);
        time(result.resolvedAt, "Manual resolution time");
        requireTask(
          result.resolvedAt >= plan.acceptedAt &&
            result.resolvedAt <= updatedAt,
          "Resolution time is outside the task.",
        );
      }
    });
  }
}

export function validateResolution(value) {
  id(value.operationId, "Manual resolution identity");
  choice(value.status, ["completed", "cancelled"], "Manual resolution status");
  text(value.note, 1000, "What happened");
}

export function hasPendingManualSteps(task) {
  return task.manualPlans.some((plan) =>
    plan.steps.some((step) => step.resolution === null),
  );
}

export function acceptManualAnswer(task, question) {
  if (!question.alternative || question.answer.value !== ACCEPT_ALTERNATIVE)
    return;
  requireTask(
    task.manualPlans.length < 8,
    "Resolve this task before adding more alternatives.",
  );
  requireTask(
    !task.manualPlans.some(
      (plan) =>
        plan.proposal.capabilityId === question.alternative.capabilityId,
    ),
    "This alternative is already chosen.",
  );
  task.manualPlans.push({
    questionId: question.id,
    acceptedAt: task.updatedAt,
    proposal: structuredClone(question.alternative),
    steps: question.alternative.steps.map((step) => ({
      id: step.id,
      resolution: null,
    })),
  });
}

/** Creator command only. Neither generated code nor a ready result resolves human work. */
export function resolveManualStep(task, command) {
  validateResolution(command);
  id(command.questionId, "Alternative question ID");
  id(command.stepId, "Manual step ID");
  const plan = task.manualPlans.find(
    (item) => item.questionId === command.questionId,
  );
  const step = plan?.steps.find((item) => item.id === command.stepId);
  requireTask(step, "This manual step was not found.");
  const used = task.manualPlans
    .flatMap((item) => item.steps)
    .find((item) => item.resolution?.operationId === command.operationId);
  if (used) {
    requireTask(
      used === step &&
        used.resolution.status === command.status &&
        used.resolution.note === command.note,
      "Resolution identity conflicts with its original input.",
    );
    return true;
  }
  requireTask(
    step.resolution === null,
    "This manual step is already resolved.",
  );
  step.resolution = {
    operationId: command.operationId,
    status: command.status,
    note: command.note,
    resolvedAt: task.updatedAt,
  };
  if (
    ["ready", "stopped"].includes(task.state) &&
    !hasPendingManualSteps(task)
  ) {
    task.finishedAt = task.updatedAt;
    task.expiresAt = task.updatedAt + TASK_LIMITS.retentionMs;
  }
  return false;
}

export function manualFieldLabel(field) {
  return `${field.label} — ${field.purpose}`;
}
