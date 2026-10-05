import { TASK_FAILURES, TASK_LIMITS as limits } from "./limits.js";
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
  ask: ["question"],
  answer: ["questionId", "questionRevision", "operationId", "value"],
  complete: ["result"],
  fail: ["failure"],
  resume: [],
  stop: [],
  recover: [],
  expire: [],
  reconcile_operation: ["operation"],
  record_operation: ["operation"],
  reserve_usage: ["modelTurns", "toolCalls"],
  settle_usage: ["modelTurns", "toolCalls", "consumed"],
};
const workerCommands = [
  "checkpoint",
  "ask",
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
      command.kind === "reconcile_operation",
    "This task attempt is terminal.",
  );
  if (
    !["stop", "recover", "expire", "reconcile_operation"].includes(command.kind)
  )
    requireTask(guard.now < task.deadlineAt, "Task deadline has passed.");
  task.updatedAt = guard.now;
  const replay = applyCommand(task, command, guard);
  if (replay) return parseTaskRecord(value);
  task.revision++;
  return parseTaskRecord(task);
}

function applyCommand(task, command, guard) {
  switch (command.kind) {
    case "claim": {
      requireTask(
        task.state === "queued" && guard.now >= task.nextRunAt,
        "Task cannot be claimed yet.",
      );
      id(command.claimId, "Claim ID");
      integer(command.leaseMs, limits.leaseMs, "Claim duration", 1);
      task.state = "running";
      task.generation++;
      task.claim = {
        id: command.claimId,
        claimedAt: guard.now,
        expiresAt: Math.min(guard.now + command.leaseMs, task.deadlineAt),
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
      task.stepId = command.stepId;
      finishClaim(task, "queued");
      break;
    case "ask":
      validateQuestion(command.question);
      requireTask(
        command.question.answer === null &&
          !task.questions.some((item) => item.id === command.question.id),
        "A question must be new and unanswered.",
      );
      requireSettledUsage(task);
      task.questions.push(structuredClone(command.question));
      finishClaim(task, "waiting_for_answer");
      break;
    case "answer":
      return answerQuestion(task, command);
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
        task.state === "failed" && TASK_FAILURES[task.failure.code].retryable,
        "Task failure cannot be resumed.",
      );
      requireTask(task.retries < limits.retries, "Task retry limit reached.");
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
    case "expire":
      requireTask(
        ["queued", "running", "waiting_for_answer"].includes(task.state) &&
          guard.now >= task.deadlineAt,
        "Only an unfinished task past its deadline can expire.",
      );
      preserveUncertainOperations(task, guard.now);
      task.failure = { code: "deadline_exceeded", stepId: task.stepId };
      finishClaim(task, "failed");
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
  const used = task.questions.find(
    (item) => item.answer?.operationId === command.operationId,
  );
  if (used) {
    requireTask(
      used === question && used.answer.value === command.value,
      "Answer identity conflicts with its original input.",
    );
    return true;
  }
  requireTask(
    task.state === "waiting_for_answer" &&
      question.answer === null &&
      question.revision === command.questionRevision,
    "Question is no longer awaiting this answer.",
  );
  question.answer = {
    operationId: command.operationId,
    value: command.value,
    answeredAt: task.updatedAt,
  };
  question.revision++;
  finishClaim(task, "queued");
  return false;
}

function recoverClaim(task, now) {
  requireTask(
    task.state === "running" && now >= task.claim.expiresAt,
    "Only an expired execution claim can be recovered.",
  );
  preserveUncertainOperations(task, now);
  if (now >= task.deadlineAt || task.retries >= limits.retries) {
    task.failure = {
      code: now >= task.deadlineAt ? "deadline_exceeded" : "budget_exceeded",
      stepId: task.stepId,
    };
    finishClaim(task, "failed");
  } else {
    task.retries++;
    finishClaim(task, "queued");
  }
}

function updateUsage(task, command) {
  integer(command.modelTurns, limits.modelTurns, "Model turn reservation");
  integer(command.toolCalls, limits.toolCalls, "Tool call reservation");
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
