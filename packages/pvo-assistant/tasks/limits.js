export const TASK_LIMITS = Object.freeze({
  idBytes: 128,
  fingerprintBytes: 128,
  requestBytes: 4000,
  examples: 8,
  exampleBytes: 2000,
  components: 8,
  sourceBytes: 20_000,
  inputBytes: 128 * 1024,
  recordBytes: 256 * 1024,
  questions: 16,
  questionBytes: 2000,
  choices: 6,
  choiceBytes: 200,
  answerBytes: 4000,
  operations: 64,
  resources: 8,
  artifactBytes: 1024 * 1024,
  lifetimeMs: 24 * 60 * 60_000,
  retentionMs: 7 * 24 * 60 * 60_000,
  leaseMs: 60_000,
  retries: 3,
  modelTurns: 6,
  toolCalls: 24,
});

export const TASK_STATES = Object.freeze([
  "queued",
  "running",
  "waiting_for_answer",
  "ready",
  "failed",
  "stopped",
]);

// Only fixed public classifications enter durable task errors.
export const TASK_FAILURES = Object.freeze({
  provider_unavailable: Object.freeze({ retryable: true }),
  interrupted: Object.freeze({ retryable: true }),
  reconciliation_required: Object.freeze({ retryable: true }),
  execution_failed: Object.freeze({ retryable: true }),
  invalid_result: Object.freeze({ retryable: false }),
  budget_exceeded: Object.freeze({ retryable: false }),
  deadline_exceeded: Object.freeze({ retryable: false }),
});
