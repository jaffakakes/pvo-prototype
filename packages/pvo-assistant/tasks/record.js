import { TASK_LIMITS as limits, TASK_STATES } from "./limits.js";
import {
  boundedJson,
  digest,
  id,
  integer,
  list,
  object,
  requireTask,
  text,
  time,
  unique,
} from "./validation.js";
import {
  validateContext,
  validateExamples,
  validateFailure,
  validateQuestion,
  validateResult,
  validateUsage,
} from "./content.js";
import { hasUnsettledOperations, validateOperation } from "./operations.js";

export function parseTaskInput(value) {
  object(
    value,
    ["operationId", "projectId", "request", "examples", "context"],
    "Task input",
  );
  id(value.operationId, "Creation operation ID");
  id(value.projectId, "Server project ID");
  text(value.request, limits.requestBytes, "Task request");
  validateExamples(value.examples);
  validateContext(value.context);
  boundedJson(value, limits.inputBytes, "Task input");
  return structuredClone(value);
}

export function parseTaskRecord(value) {
  object(
    value,
    [
      "id",
      "ownerId",
      "input",
      "creationDigest",
      "state",
      "stepId",
      "revision",
      "generation",
      "claim",
      "questions",
      "operations",
      "archivedOperations",
      "result",
      "failure",
      "retries",
      "usage",
      "createdAt",
      "updatedAt",
      "finishedAt",
      "expiresAt",
      "nextRunAt",
    ],
    "Task record",
  );
  id(value.id, "Task ID");
  id(value.ownerId, "Owner ID");
  parseTaskInput(value.input);
  digest(value.creationDigest, "Creation input digest");
  choiceState(value);
  id(value.stepId, "Current step ID");
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Task revision");
  integer(value.generation, value.revision, "Execution generation");
  integer(value.retries, Number.MAX_SAFE_INTEGER, "Retry count");
  integer(
    value.archivedOperations,
    Number.MAX_SAFE_INTEGER,
    "Archived operation count",
  );
  validateUsage(value.usage);
  for (const key of ["createdAt", "updatedAt"])
    time(value[key], "Task timestamp");
  requireTask(
    value.createdAt <= value.updatedAt,
    "Task timestamps or retention are inconsistent.",
  );
  const finished = ["ready", "stopped"].includes(value.state);
  if (finished) {
    time(value.finishedAt, "Goal finish time");
    time(value.expiresAt, "Finished goal retention");
    requireTask(
      value.finishedAt >= value.createdAt &&
        value.finishedAt <= value.updatedAt &&
        value.expiresAt === value.finishedAt + limits.retentionMs,
      "Finished goal retention is inconsistent.",
    );
  } else {
    requireTask(
      value.finishedAt === null && value.expiresAt === null,
      "Unfinished goals do not expire.",
    );
  }
  validateClaim(value);
  if (value.result !== null) {
    validateResult(value.result);
    requireTask(
      value.result.baseFingerprint === value.input.context.fingerprint,
      "Result belongs to a different project snapshot.",
    );
  }
  if (value.failure !== null) {
    validateFailure(value.failure);
    requireTask(
      value.failure.stepId === value.stepId,
      "Failure belongs to a different step.",
    );
  }
  validateHistory(value);
  requireTask(
    (value.state === "ready") === (value.result !== null),
    "Ready state and prepared result must agree.",
  );
  requireTask(
    (value.state === "failed") === (value.failure !== null),
    "Failed state and failure must agree.",
  );
  if (["ready", "waiting_for_answer"].includes(value.state)) {
    requireTask(
      !hasUnsettledOperations(value.operations),
      "Uncertain operations must be reconciled first.",
    );
    requireTask(
      !value.usage.reservedModelTurns && !value.usage.reservedToolCalls,
      "Usage reservations must be settled first.",
    );
  }
  boundedJson(value, limits.recordBytes, "Task record");
  return structuredClone(value);
}

function choiceState(value) {
  requireTask(TASK_STATES.includes(value.state), "Task state is unsupported.");
}

function validateClaim(value) {
  requireTask(
    (value.state === "running") === (value.claim !== null),
    "Only a running task has an execution claim.",
  );
  if (value.claim !== null) {
    object(value.claim, ["id", "claimedAt", "expiresAt"], "Execution claim");
    id(value.claim.id, "Claim ID");
    time(value.claim.claimedAt, "Claim start");
    time(value.claim.expiresAt, "Claim expiry");
    requireTask(
      value.generation > 0 &&
        value.claim.claimedAt >= value.createdAt &&
        value.claim.claimedAt <= value.updatedAt &&
        value.claim.expiresAt > value.updatedAt &&
        value.claim.expiresAt - value.claim.claimedAt <= limits.leaseMs,
      "Execution claim has inconsistent bounds.",
    );
  }
  if (value.state === "queued") {
    time(value.nextRunAt, "Next wakeup");
    requireTask(
      value.nextRunAt >= value.createdAt,
      "Queued wakeup precedes goal creation.",
    );
  } else
    requireTask(
      value.nextRunAt === null,
      "Only queued tasks have a next wakeup.",
    );
}

function validateHistory(value) {
  list(value.questions, limits.questions, "Task questions");
  value.questions.forEach(validateQuestion);
  unique(
    value.questions.map((item) => item.id),
    "Question IDs",
  );
  const pending = value.questions.filter((item) => item.answer === null).length;
  let validPending = pending === 0;
  if (value.state === "waiting_for_answer") validPending = pending === 1;
  if (value.state === "stopped") validPending = pending <= 1;
  requireTask(
    validPending,
    "Unanswered questions do not match the task state.",
  );
  for (const question of value.questions)
    if (question.answer)
      requireTask(
        question.answer.answeredAt >= value.createdAt &&
          question.answer.answeredAt <= value.updatedAt,
        "Answer timestamp is outside task history.",
      );
  list(value.operations, limits.operations, "Operation receipts");
  for (const operation of value.operations) {
    validateOperation(operation);
    requireTask(
      operation.createdAt >= value.createdAt &&
        operation.updatedAt <= value.updatedAt,
      "Operation timestamp is outside task history.",
    );
  }
  unique(
    [
      value.input.operationId,
      ...value.operations.map((item) => item.id),
      ...value.questions
        .filter((item) => item.answer)
        .map((item) => item.answer.operationId),
    ],
    "Task operation identities",
  );
}

/** Metadata must come from the trusted account/clock/ID/hash adapters, never request fields. */
export function createTask(input, metadata) {
  const parsed = parseTaskInput(input);
  object(
    metadata,
    ["id", "ownerId", "now", "inputDigest"],
    "Creation metadata",
  );
  return parseTaskRecord({
    id: metadata.id,
    ownerId: metadata.ownerId,
    input: parsed,
    creationDigest: metadata.inputDigest,
    state: "queued",
    stepId: "plan",
    revision: 0,
    generation: 0,
    claim: null,
    questions: [],
    operations: [],
    archivedOperations: 0,
    result: null,
    failure: null,
    retries: 0,
    usage: {
      modelTurns: 0,
      toolCalls: 0,
      reservedModelTurns: 0,
      reservedToolCalls: 0,
    },
    createdAt: metadata.now,
    updatedAt: metadata.now,
    finishedAt: null,
    expiresAt: null,
    nextRunAt: metadata.now,
  });
}

function inputSnapshot(value) {
  return JSON.stringify([
    value.operationId,
    value.projectId,
    value.request,
    value.examples.map((item) => [item.id, item.input, item.expected]),
    value.context.fingerprint,
    value.context.components.map((item) => [
      item.id,
      item.sceneId,
      item.type,
      item.source.structure,
      item.source.style,
      item.source.logic,
    ]),
  ]);
}

/** Validate a duplicate create after the repository looks it up by owner and operation ID. */
export function replayTaskCreation(task, input, metadata) {
  const current = parseTaskRecord(task);
  const request = parseTaskInput(input);
  object(metadata, ["ownerId", "inputDigest"], "Replay metadata");
  requireTask(metadata.ownerId === current.ownerId, "Task access denied.");
  digest(metadata.inputDigest, "Creation input digest");
  requireTask(
    current.creationDigest === metadata.inputDigest &&
      inputSnapshot(current.input) === inputSnapshot(request),
    "Creation identity conflicts with its original input.",
  );
  return current;
}
