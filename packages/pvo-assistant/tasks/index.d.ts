/** Pure task contract; storage and authorization adapters must enforce their own boundaries. */
export type TaskState =
  "queued" | "running" | "waiting_for_answer" | "ready" | "failed" | "stopped";
export type TaskFailureCode =
  | "provider_unavailable"
  | "interrupted"
  | "reconciliation_required"
  | "execution_failed"
  | "invalid_result"
  | "budget_exceeded"
  | "deadline_exceeded";
export type TaskFailure = { code: TaskFailureCode; stepId: string };
export type TaskArtifact = { id: string; sha256: string; bytes: number };
export type TaskResult = { artifact: TaskArtifact; baseFingerprint: string };
export type TaskReference = {
  ownerId: string;
  projectId: string;
  taskId: string;
};
export type TaskContext = {
  fingerprint: string;
  components: Array<{
    id: string;
    sceneId: string;
    type: "tooltip" | "card" | "choice" | "form";
    source: { structure: string; style: string; logic: string };
  }>;
};
export type TaskInput = {
  operationId: string;
  projectId: string;
  request: string;
  examples: Array<{ id: string; input: string; expected: string }>;
  context: TaskContext;
};
export type TaskQuestion = {
  id: string;
  revision: number;
  prompt: string;
  choices: string[];
  answer: null | { operationId: string; value: string; answeredAt: number };
};
export type TaskOperation = {
  id: string;
  stepId: string;
  inputDigest: string;
  status: "planned" | "unknown" | "completed" | "absent" | "failed";
  resources: Array<{ kind: "workspace" | "service" | "artifact"; id: string }>;
  artifact: TaskArtifact | null;
  failure: TaskFailure | null;
  createdAt: number;
  updatedAt: number;
};
export type TaskUsage = {
  modelTurns: number;
  toolCalls: number;
  reservedModelTurns: number;
  reservedToolCalls: number;
};
export type TaskRecord = {
  id: string;
  ownerId: string;
  input: TaskInput;
  creationDigest: string;
  state: TaskState;
  stepId: string;
  revision: number;
  generation: number;
  claim: null | { id: string; claimedAt: number; expiresAt: number };
  questions: TaskQuestion[];
  operations: TaskOperation[];
  result: TaskResult | null;
  failure: TaskFailure | null;
  retries: number;
  usage: TaskUsage;
  createdAt: number;
  updatedAt: number;
  deadlineAt: number;
  expiresAt: number;
  nextRunAt: number | null;
};
export type TaskGuard = {
  /** Trusted caller identity, not a field accepted from a request body. */
  ownerId: string;
  expectedRevision: number;
  now: number;
  claim: null | { id: string; generation: number };
};
export type TaskCommand =
  | { kind: "claim"; claimId: string; leaseMs: number }
  | { kind: "checkpoint"; stepId: string }
  | { kind: "ask"; question: TaskQuestion }
  | {
      kind: "answer";
      questionId: string;
      questionRevision: number;
      operationId: string;
      value: string;
    }
  | { kind: "complete"; result: TaskResult }
  | { kind: "fail"; failure: TaskFailure }
  | { kind: "resume" | "stop" | "recover" | "expire" }
  | {
      kind: "record_operation" | "reconcile_operation";
      operation: TaskOperation;
    }
  | { kind: "reserve_usage"; modelTurns: number; toolCalls: number }
  | {
      kind: "settle_usage";
      modelTurns: number;
      toolCalls: number;
      consumed: boolean;
    };
export const TASK_LIMITS: Readonly<{
  idBytes: number;
  fingerprintBytes: number;
  requestBytes: number;
  examples: number;
  exampleBytes: number;
  components: number;
  sourceBytes: number;
  inputBytes: number;
  recordBytes: number;
  questions: number;
  questionBytes: number;
  choices: number;
  choiceBytes: number;
  answerBytes: number;
  operations: number;
  resources: number;
  artifactBytes: number;
  lifetimeMs: number;
  retentionMs: number;
  leaseMs: number;
  retries: number;
  modelTurns: number;
  toolCalls: number;
}>;
export const TASK_STATES: readonly TaskState[];
export const TASK_FAILURES: Readonly<
  Record<TaskFailureCode, Readonly<{ retryable: boolean }>>
>;
export function parseTaskInput(value: unknown): TaskInput;
export function parseTaskReference(value: unknown): TaskReference;
export function parseTaskRecord(value: unknown): TaskRecord;
export function createTask(
  input: unknown,
  metadata: { id: string; ownerId: string; now: number; inputDigest: string },
): TaskRecord;
export function replayTaskCreation(
  task: unknown,
  input: unknown,
  metadata: { ownerId: string; inputDigest: string },
): TaskRecord;
/** Caller must commit this record with an atomic revision comparison before effects. */
export function transitionTask(
  task: unknown,
  command: TaskCommand,
  guard: TaskGuard,
): TaskRecord;
