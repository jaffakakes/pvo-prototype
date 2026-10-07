import { SERVICE_EXECUTION_LIMITS } from "../../../packages/pvo-assistant/services/index.js";

/** Exact reviewed runner/base identity; verify with the Node runtime build/proof before release. */
export const NODE_RUNTIME = Object.freeze({
  name: "nodejs-esm",
  nodeVersion: "24.20.0",
  baseImage:
    "node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa",
  runnerDigest:
    "73dc5f1be4113b457ed0c64b4b3abc168e038ae092ae9a8c64a355718dc0c7dc",
  imageDigest:
    "sha256:9942e6c3dccc44a923c70ef9d8b3b7609b1a8338ea05b33ca80047952d0f449b",
});
export const NODE_LIMITS = Object.freeze({
  preparationMs: 120000,
  startupMs: 30000,
  uploadMs: 100000,
  executionMs: 2000,
  transportMs: 5000,
  watchdogSeconds: 180,
  cleanupMs: SERVICE_EXECUTION_LIMITS.cleanupMs,
  leaseMs: SERVICE_EXECUTION_LIMITS.leaseMs,
  region: "iad",
  cpuKind: "shared",
  cpus: 1,
  memoryMiB: 1024,
  slots: 2,
  replyBytes: 64 * 1024,
  invocationBytes: 64 * 1024,
  requestBytes: 1152 * 1024,
});
