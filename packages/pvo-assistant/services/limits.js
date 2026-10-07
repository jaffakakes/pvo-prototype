export const SERVICE_PACKAGE_LIMITS = Object.freeze({
  operations: 8,
  cases: 16,
  caseSteps: 8,
  totalSteps: 64,
  schemaNodes: 256,
  schemaDepth: 8,
  fields: 24,
  arrayItems: 128,
  stringBytes: 8192,
  inputBytes: 8192,
  resultBytes: 8192,
  stateBytes: 48 * 1024,
  envelopeBytes: 64 * 1024,
  agreementBytes: 256 * 1024,
  files: 32,
  fileBytes: 128 * 1024,
  packageBytes: 1024 * 1024,
  tests: 8,
});

/** Per-invocation resource recovery bounds; a task may continue through additional saved steps. */
export const SERVICE_EXECUTION_LIMITS = Object.freeze({
  leaseMs: 300000,
  cleanupMs: 5000,
  requestMs: 315000,
  validationStepMs: 310000,
  validationClaimMs: 330000,
});
