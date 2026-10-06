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

export const SERVICE_RUNTIME = "cloudflare-workers-esm";
