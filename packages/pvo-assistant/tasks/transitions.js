import { acceptManualAnswer, resolveManualStep } from "./manual.js";
import { TASK_FAILURES, TASK_LIMITS as limits } from "./limits.js";
import {
  checkpointTaskOperations,
  checkpointTaskQuestions,
  checkpointTaskQuestionBytes,
} from "./checkpoint.js";
import { parseTaskRecord } from "./record.js";
import { object, id, integer, requireTask, text } from "./validation.js";
import {
  validateFailure,
  validateQuestion,
  validateResult,
} from "./content.js";
import { hasUnsettledOperations, updateOperation } from "./operations.js";
import {
  finishClaim,
  requireRunningClaim,
  requireSettledUsage,
  validateGuard,
} from "./transition-guards.js";

const fields = {
  claim: ["claimId", "leaseMs"],
  checkpoint: ["stepId"],
  wait: ["reason", "nextRunAt"],
  ask: ["question"],
  ask_research: ["question"],
  resolve_manual: ["questionId", "stepId", "operationId", "status", "note"],
  answer: ["questionId", "questionRevision", "operationId", "value"],
  answer_connection: [
    "questionId",
    "questionRevision",
    "operationId",
    "value",
    "connectionId",
  ],
  complete: ["result"],
  fail: ["failure"],
  resume: [],
  stop: [],
  recover: [],
  reconcile_operation: ["operation"],
  record_operation: ["operation"],
  reserve_usage: ["modelTurns", "toolCalls"],
  settle_usage: ["modelTurns", "toolCalls", "consumed"],
  reconcile_usage: ["operationId", "modelTurns", "toolCalls", "consumed"],
};
const workerCommands = [
  "checkpoint",
  "wait",
  "ask",
  "ask_research",
  "complete",
  "fail",
  "record_operation",
  "reserve_usage",
  "settle_usage",
];

/** Returns a new record only; the storage adapter must compare-and-swap the original revision. */
export function transitionTask(value, command, guard) {
  const task = parseTaskRecord(value);
  validateGuard(task, guard);
  requireTask(
    command !== null &&
      typeof command === "object" &&
      Object.hasOwn(fields, command.kind),
    "Task command is unsupported.",
  );
  object(command, ["kind", ...fields[command.kind]], "Task command");
  if (workerCommands.includes(command.kind)) requireRunningClaim(task, guard);
  else
    requireTask(
      guard.claim === null,
      "Creator/coordinator commands do not carry a worker claim.",
    );
  requireTask(
    !["ready", "stopped"].includes(task.state) ||
      ["reconcile_operation", "reconcile_usage", "resolve_manual"].includes(
        command.kind,
      ),
    "This task attempt is terminal.",
  );
  checkpointTaskOperations(task, command.operation?.id ?? command.operationId);
  checkpointTaskQuestions(task, command.questionId);
  task.updatedAt = guard.now;
  const replay = applyCommand(task, command, guard);
  if (replay) return parseTaskRecord(value);
  task.revision++;
  checkpointTaskQuestionBytes(task, command.questionId);
  return parseTaskRecord(task);
}

function applyCommand(task, command, guard) {
  switch (command.kind) {
    case "claim": {
      requireTask(
        ["queued", "waiting"].includes(task.state) &&
          task.nextRunAt !== null &&
          guard.now >= task.nextRunAt,
        "Task cannot be claimed yet.",
      );
      id(command.claimId, "Claim ID");
      integer(command.leaseMs, limits.leaseMs, "Claim duration", 1);
      task.state = "running";
      task.wait = null;
      task.generation++;
      task.claim = {
        id: command.claimId,
        claimedAt: guard.now,
        expiresAt: guard.now + command.leaseMs,
      };
      task.nextRunAt = null;
      break;
    }
    case "checkpoint":
      id(command.stepId, "Next step ID");
      requireSettledUsage(task);
      requireTask(
        !hasUnsettledOperations(task.operations),
        "Reconcile unfinished operations before advancing steps.",
      );
      requireTask(
        !task.questions.some((question) => question.answer === null) ||
          command.stepId === "build",
        "Answer the pending question before dependent work.",
      );
      task.stepId = command.stepId;
      finishClaim(
        task,
        task.questions.some((question) => question.answer === null)
          ? "waiting_for_answer"
          : "queued",
      );
      break;
    case "wait":
      requireSettledUsage(task);
      requireTask(
        !hasUnsettledOperations(task.operations),
        "Reconcile unfinished operations before waiting.",
      );
      requireTask(
        command.nextRunAt === null || command.nextRunAt > guard.now,
        "A scheduled wait must wake in the future.",
      );
      finishClaim(task, "waiting");
      task.wait = { reason: command.reason };
      task.nextRunAt = command.nextRunAt;
      break;
    case "ask_research":
      requireTask(
        task.stepId === "build",
        "Independent research requires the build step.",
      );
    // Both commands save the same question; only the independent research batch stays queued.
    case "ask":
      validateQuestion(command.question);
      requireTask(
        command.question.answer === null &&
          !task.questions.some((item) => item.id === command.question.id),
        "A question must be new and unanswered.",
      );
      requireSettledUsage(task);
      task.questions.push(structuredClone(command.question));
      finishClaim(
        task,
        command.kind === "ask_research" ? "queued" : "waiting_for_answer",
      );
      break;
    case "answer":
    case "answer_connection":
      return answerQuestion(task, command);
    case "resolve_manual":
      requireTask(
        task.state !== "running",
        "Wait for current work before recording a manual result.",
      );
      return resolveManualStep(task, command);
    case "complete":
      validateResult(command.result);
      task.result = structuredClone(command.result);
      finishClaim(task, "ready");
      break;
    case "fail":
      validateFailure(command.failure);
      task.failure = structuredClone(command.failure);
      finishClaim(task, "failed");
      break;
    case "resume":
      requireTask(
        (task.state === "failed" &&
          TASK_FAILURES[task.failure.code].retryable) ||
          task.state === "waiting",
        "Task failure cannot be resumed.",
      );
      task.retries++;
      task.failure = null;
      finishClaim(task, "queued");
      break;
    case "stop":
      preserveUncertainOperations(task, guard.now);
      task.failure = null;
      finishClaim(task, "stopped");
      break;
    case "recover":
      recoverClaim(task, guard.now);
      break;
    case "reconcile_operation":
      requireTask(
        task.state !== "running",
        "Active work must use its execution claim.",
      );
      requireTask(
        task.operations.some(
          (operation) => operation.id === command.operation?.id,
        ),
        "Reconciliation cannot start a new operation.",
      );
      return recordOperation(task, command.operation, guard.now);
    case "record_operation": {
      requireTask(
        command.operation?.stepId === task.stepId,
        "Receipt belongs to a different step.",
      );
      return recordOperation(task, command.operation, guard.now);
    }
    case "reserve_usage":
    case "settle_usage":
      updateUsage(task, command);
      break;
    case "reconcile_usage":
      id(command.operationId, "Reconciled operation ID");
      requireTask(
        task.state !== "running" &&
          !hasUnsettledOperations(task.operations) &&
          task.operations.some(
            (operation) => operation.id === command.operationId,
          ),
        "Usage reconciliation requires a settled operation and no active worker.",
      );
      updateUsage(task, command);
      break;
  }
  return false;
}

function answerQuestion(task, command) {
  id(command.questionId, "Question ID");
  id(command.operationId, "Answer operation ID");
  integer(command.questionRevision, 0, "Question revision");
  text(command.value, limits.answerBytes, "Answer text");
  const question = task.questions.find(
    (item) => item.id === command.questionId,
  );
  requireTask(question, "Question was not found.");
  if (command.kind === "answer_connection") {
    requireTask(
      Boolean(question.connection),
      "This question does not request an account.",
    );
    id(command.connectionId, "Saved connection reference");
  } else
    requireTask(
      !question.connection ||
        command.value === "Continue without this connection",
      "Use private account setup to connect, or explicitly continue without it.",
    );
  const used = task.questions.find(
    (item) => item.answer?.operationId === command.operationId,
  );
  if (used) {
    requireTask(
      used === question &&
        used.answer.value === command.value &&
        used.answer.connectionId === command.connectionId,
      "Answer identity conflicts with its original input.",
    );
    return true;
  }
  requireTask(
    ["waiting_for_answer", "queued", "running", "waiting", "failed"].includes(
      task.state,
    ) &&
      question.answer === null &&
      question.revision === command.questionRevision,
    "Question is no longer awaiting this answer.",
  );
  question.answer = {
    operationId: command.operationId,
    value: command.value,
    answeredAt: task.updatedAt,
    ...(command.kind === "answer_connection"
      ? { connectionId: command.connectionId }
      : {}),
  };
  acceptManualAnswer(task, question);
  question.revision++;
  if (task.state === "waiting_for_answer") finishClaim(task, "queued");
  return false;
}

function recoverClaim(task, now) {
  requireTask(
    task.state === "running" && now >= task.claim.expiresAt,
    "Only an expired execution claim can be recovered.",
  );
  preserveUncertainOperations(task, now);
  task.retries++;
  finishClaim(task, "queued");
}

function updateUsage(task, command) {
  integer(
    command.modelTurns,
    Number.MAX_SAFE_INTEGER,
    "Model turn reservation",
  );
  integer(command.toolCalls, Number.MAX_SAFE_INTEGER, "Tool call reservation");
  requireTask(
    command.modelTurns + command.toolCalls > 0,
    "A usage change must reserve or settle work.",
  );
  if (command.kind === "reserve_usage") {
    task.usage.reservedModelTurns += command.modelTurns;
    task.usage.reservedToolCalls += command.toolCalls;
    return;
  }
  requireTask(
    typeof command.consumed === "boolean",
    "Usage settlement needs a consumed decision.",
  );
  requireTask(
    command.modelTurns <= task.usage.reservedModelTurns &&
      command.toolCalls <= task.usage.reservedToolCalls,
    "Cannot settle usage that was not reserved.",
  );
  task.usage.reservedModelTurns -= command.modelTurns;
  task.usage.reservedToolCalls -= command.toolCalls;
  if (command.consumed) {
    task.usage.modelTurns += command.modelTurns;
    task.usage.toolCalls += command.toolCalls;
  }
}

function preserveUncertainOperations(task, now) {
  task.operations = task.operations.map((operation) =>
    operation.status === "planned"
      ? { ...operation, status: "unknown", updatedAt: now }
      : operation,
  );
}

function recordOperation(task, incoming, now) {
  const operations = updateOperation(task.operations, incoming, now);
  if (operations === task.operations) return true;
  task.operations = operations;
  return false;
}
