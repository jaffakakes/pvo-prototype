/** Pure task contract; storage and authorization adapters must enforce their own boundaries. */
export type TaskState =
  | "queued"
  | "running"
  | "waiting_for_answer"
  | "waiting"
  | "ready"
  | "failed"
  | "stopped";
export type TaskFailureCode =
  | "provider_unavailable"
  | "interrupted"
  | "reconciliation_required"
  | "execution_failed"
  | "tests_failed"
  | "invalid_result"
  | "budget_exceeded";
export type TaskWaitReason =
  | "model_capacity"
  | "model_allowance"
  | "workspace_capacity"
  | "workspace_allowance"
  | "service_capacity"
  | "service_allowance"
  | "spending_permission";
export type TaskFailure = { code: TaskFailureCode; stepId: string };
export type TaskArtifact = { id: string; sha256: string; bytes: number };
export type TaskResult = { artifact: TaskArtifact; baseFingerprint: string };
export type TaskReference = {
  ownerId: string;
  projectId: string;
  taskId: string;
};
export type OwnedProjectLink = Omit<TaskReference, "taskId"> & {
  taskId: string | null;
};
export type TaskContext = {
  fingerprint: string;
  currentSceneId: string;
  scenes: Array<{ id: string; name: string; duration: number }>;
  components: Array<{
    id: string;
    sceneId: string;
    type: "tooltip" | "card" | "choice" | "form";
    sourceVisibility: "full" | "design";
    source: { structure: string; style: string; logic: string };
  }>;
};
export type ContainerTaskContext = {
  fingerprint: string;
  container: {
    serviceId: string;
    revision: number;
    mode: "edit" | "test" | "repair";
  };
};
export type TaskInput = {
  operationId: string;
  projectId: string;
  request: string;
  examples: Array<{ id: string; input: string; expected: string }>;
  context: TaskContext | ContainerTaskContext;
};
export type TaskProposal = { examples: TaskInput["examples"] };
export function parseTaskProposal(value: unknown): TaskProposal;
export const taskProposalSchema: Readonly<Record<string, unknown>>;
export type ManualAlternative = {
  capabilityId: string;
  originalOutcome: string;
  preparedOutcome: string;
  limitation: string;
  notice: string;
  fields: Array<{
    name: string;
    kind: "name" | "email" | "phone" | "short" | "number" | "yesno";
    label: string;
    purpose: string;
  }>;
  steps: Array<{ id: string; instruction: string }>;
};
export type ManualResolution = {
  operationId: string;
  status: "completed" | "cancelled";
  note: string;
  resolvedAt: number;
};
export type ManualPlan = {
  questionId: string;
  acceptedAt: number;
  proposal: ManualAlternative;
  steps: Array<{ id: string; resolution: ManualResolution | null }>;
};
export function parseManualAlternative(value: unknown): ManualAlternative;
export function hasPendingManualSteps(task: TaskRecord): boolean;
export function manualFieldLabel(
  field: ManualAlternative["fields"][number],
): string;
export const ACCEPT_ALTERNATIVE: string;
export const DECLINE_ALTERNATIVE: string;
export const manualAlternativeSchema: Readonly<Record<string, unknown>>;
export type TaskQuestion = {
  alternative?: ManualAlternative;
  id: string;
  revision: number;
  prompt: string;
  choices: string[];
  connection?: import("../connections/index.js").ConnectionSetup;
  answer: null | {
    operationId: string;
    value: string;
    answeredAt: number;
    connectionId?: string;
  };
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
  archivedQuestions: number;
  manualPlans: ManualPlan[];
  operations: TaskOperation[];
  archivedOperations: number;
  result: TaskResult | null;
  failure: TaskFailure | null;
  wait: { reason: TaskWaitReason } | null;
  retries: number;
  usage: TaskUsage;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  expiresAt: number | null;
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
  | { kind: "wait"; reason: TaskWaitReason; nextRunAt: number | null }
  | { kind: "ask" | "ask_research"; question: TaskQuestion }
  | {
      kind: "answer";
      questionId: string;
      questionRevision: number;
      operationId: string;
      value: string;
    }
  | {
      kind: "answer_connection";
      questionId: string;
      questionRevision: number;
      operationId: string;
      value: string;
      connectionId: string;
    }
  | {
      kind: "resolve_manual";
      questionId: string;
      stepId: string;
      operationId: string;
      status: "completed" | "cancelled";
      note: string;
    }
  | { kind: "complete"; result: TaskResult }
  | { kind: "fail"; failure: TaskFailure }
  | { kind: "resume" | "stop" | "recover" }
  | {
      kind: "record_operation" | "reconcile_operation";
      operation: TaskOperation;
    }
  | { kind: "reserve_usage"; modelTurns: number; toolCalls: number }
  | {
      kind: "reconcile_usage";
      operationId: string;
      modelTurns: number;
      toolCalls: number;
      consumed: boolean;
    }
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
  scenes: number;
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
  retentionMs: number;
  leaseMs: number;
  defaultLeaseMs: number;
}>;
export const TASK_STATES: readonly TaskState[];
export const TASK_FAILURES: Readonly<
  Record<TaskFailureCode, Readonly<{ retryable: boolean }>>
>;
export function parseTaskInput(value: unknown): TaskInput;
export function parseTaskReference(value: unknown): TaskReference;
export function parseOwnedProjectLink(value: unknown): OwnedProjectLink;
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

export function assertTaskExecution(task: TaskRecord, guard: TaskGuard): void;

export function validateManualComponent(
  task: TaskRecord,
  compiled: {
    structure: import("../../pvo-language/index.js").PvoLanguageStructure;
  },
  binding: import("../attachments/index.js").ServiceInputBinding,
): void;
