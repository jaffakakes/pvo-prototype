/** Exact reviewed runner/base identity; verify with the Node runtime build/proof before release. */
export const NODE_RUNTIME = Object.freeze({
  name: "nodejs-esm",
  nodeVersion: "24.20.0",
  baseImage:
    "node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa",
  runnerDigest:
    "73dc5f1be4113b457ed0c64b4b3abc168e038ae092ae9a8c64a355718dc0c7dc",
});
export const NODE_LIMITS = Object.freeze({
  startupMs: 30000,
  executionMs: 2000,
  cleanupMs: 5000,
  leaseMs: 45000,
  memoryMiB: 256,
  vcpu: 0.0625,
  slots: 2,
  replyBytes: 64 * 1024,
  invocationBytes: 64 * 1024,
  requestBytes: 1152 * 1024,
});
