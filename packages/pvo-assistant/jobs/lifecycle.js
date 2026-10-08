import {
  object,
  id,
  time,
  requireTask,
  boundedJson,
} from "../tasks/validation.js";
import { parseServiceAction, serviceCallError } from "../hosting/index.js";

export const JOB_LIMITS = Object.freeze({
  records: 128,
  bytes: 4 * 1024 * 1024,
  daily: 256,
  attempts: 5,
  leaseMs: 120000,
  lifetimeMs: 7 * 86400000,
  retentionMs: 30 * 86400000,
  scheduleMs: 30 * 86400000,
});
export const JOB_STATES = Object.freeze([
  "received",
  "pending",
  "confirmed",
  "failed",
  "needs_checking",
]);

export function parseJobRequest(value, now) {
  object(
    value,
    ["releaseId", "action", "receiptKey", "schedule"],
    "Background request",
  );
  requireTask(
    /^release-[a-f0-9]{64}$/.test(value.releaseId),
    "Invalid release.",
  );
  const action = parseServiceAction(value.action);
  requireTask(
    /^[a-f0-9]{64}$/.test(value.receiptKey),
    "A receipt needs a private random key.",
  );
  if (value.schedule !== null) {
    object(value.schedule, ["at", "timezone"], "Schedule");
    time(value.schedule.at, "Scheduled time");
    requireTask(
      value.schedule.at <= now + JOB_LIMITS.scheduleMs,
      "Choose a time within the next thirty days.",
    );
    requireTask(
      typeof value.schedule.timezone === "string" &&
        value.schedule.timezone.length <= 100,
      "Invalid timezone.",
    );
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.schedule.timezone });
    } catch {
      throw new Error("Use an IANA timezone, such as Europe/London.");
    }
  }
  boundedJson(value, 18000, "Background request");
  return { ...structuredClone(value), action };
}

/** Trusted admission supplies the owner, release, digests and clock. No authoring-task identity is involved. */
export function createJob(identity, request, inputDigest, viewerHash, now) {
  const runAt = request.schedule?.at ?? now;
  return {
    id: request.action.actionId,
    ownerId: identity.ownerId,
    serviceId: identity.serviceId,
    releaseId: request.releaseId,
    operation: request.action.operation,
    viewerHash,
    inputDigest,
    action: request.action,
    status: "received",
    attempts: 0,
    executionDone: false,
    polls: 0,
    claim: null,
    providerReceipts: [],
    result: null,
    createdAt: now,
    updatedAt: now,
    schedule: request.schedule,
    nextAt: runAt,
    expiresAt: runAt + JOB_LIMITS.lifetimeMs,
    purgeAt: null,
    lastError: null,
    cancelledAt: null,
  };
}

export function claimJob(job, now, claimId) {
  id(claimId, "Job claim");
  if (
    !["received", "pending"].includes(job.status) ||
    job.nextAt > now ||
    (job.claim && job.claim.until > now)
  )
    return null;
  if (
    now >= job.expiresAt ||
    (!job.executionDone && job.attempts >= JOB_LIMITS.attempts)
  )
    return settleJob(job, "needs_checking", "retry_limit", now);
  return {
    ...job,
    status: "pending",
    attempts: job.attempts + (job.executionDone ? 0 : 1),
    updatedAt: now,
    claim: { id: claimId, until: now + JOB_LIMITS.leaseMs },
  };
}

export function settleJob(job, status, code, now, result = null) {
  requireTask(JOB_STATES.includes(status), "Invalid job state.");
  return {
    ...job,
    status,
    claim: null,
    nextAt: null,
    updatedAt: now,
    lastError: code,
    result,
    purgeAt: ["confirmed", "failed"].includes(status)
      ? now + JOB_LIMITS.retentionMs
      : null,
  };
}

/** An uncertain external write is never converted into an ordinary retry. */
export function failJob(job, code, writeStarted, now) {
  if (writeStarted)
    return settleJob(job, "needs_checking", "outside_result_unknown", now);
  const final = [
    "invalid_input",
    "invalid_result",
    "forbidden",
    "unavailable",
    "action_conflict",
    "incompatible_version",
  ].includes(code);
  if (final) return settleJob(job, "failed", code, now);
  if (job.attempts >= JOB_LIMITS.attempts || now >= job.expiresAt)
    return settleJob(job, "needs_checking", "retry_limit", now);
  return {
    ...job,
    claim: null,
    status: "pending",
    updatedAt: now,
    lastError: "retrying",
    nextAt: now + Math.min(3600000, 5000 * 2 ** (job.attempts - 1)),
  };
}

export function jobLabel(job) {
  if (job.cancelledAt !== null) return "Cancelled before completion";
  if (job.status === "received")
    return job.schedule ? "Scheduled request received" : "Request received";
  if (job.status === "pending" && job.providerReceipts.length)
    return "Email accepted by sender; delivery pending";
  if (job.status === "pending")
    return job.lastError === "retrying"
      ? "Waiting to retry"
      : "Request pending";
  if (job.status === "failed") return "Request failed";
  if (job.status === "needs_checking")
    return "Result needs checking; contact the creator";
  if (job.providerReceipts.some((receipt) => receipt.provider === "resend"))
    return "Email delivered to recipient’s mail server";
  return "Request completed";
}

/** Only the operation's public result leaves the host. Input, addresses and provider receipts stay private. */
export function viewerJobReceipt(job) {
  return {
    actionId: job.id,
    job: {
      status: job.status,
      label: jobLabel(job),
      updatedAt: job.updatedAt,
      result: structuredClone(job.result),
      expiresAt: job.purgeAt,
      nextCheckAt: ["received", "pending"].includes(job.status)
        ? job.updatedAt + 5000
        : null,
    },
  };
}

export function requireJobKey(job, viewerHash) {
  if (!job || job.viewerHash !== viewerHash)
    throw serviceCallError("unavailable", "This receipt is unavailable.");
}
