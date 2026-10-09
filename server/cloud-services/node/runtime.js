import {
  SERVICE_RUNTIME,
  SERVICE_EXECUTION_LIMITS,
} from "../../../packages/pvo-assistant/services/index.js";

export const NODE_RUNTIME = SERVICE_RUNTIME;
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
