import {
  object,
  id,
  time,
  integer,
  list,
  boundedJson,
  requireTask,
} from "../tasks/validation.js";
import { JOB_LIMITS, JOB_STATES, jobLabel } from "./lifecycle.js";

/** Owner-only inspection omits the viewer's secret and full submitted input. */
export function creatorJobSummary(job) {
  return {
    actionId: job.id,
    operation: job.operation,
    releaseId: job.releaseId,
    status: job.status,
    label: jobLabel(job),
    attempts: job.attempts,
    polls: job.polls,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    nextAt: job.nextAt,
    schedule: job.schedule,
    lastError: job.lastError,
    providerReceipts: job.providerReceipts,
    canCancel:
      ["received", "pending"].includes(job.status) &&
      !job.executionDone &&
      !job.claim &&
      !job.attempts,
    canResume: job.status === "needs_checking",
  };
}
export function parseCreatorJobs(value, ownerId, serviceId) {
  object(
    value,
    ["ownerId", "serviceId", "observedAt", "jobs"],
    "Background jobs",
  );
  requireTask(
    value.ownerId === ownerId && value.serviceId === serviceId,
    "The Container account changed.",
  );
  time(value.observedAt, "Observation");
  list(value.jobs, JOB_LIMITS.records, "Background jobs");
  for (const job of value.jobs) {
    object(
      job,
      [
        "actionId",
        "operation",
        "releaseId",
        "status",
        "label",
        "attempts",
        "polls",
        "createdAt",
        "updatedAt",
        "expiresAt",
        "nextAt",
        "schedule",
        "lastError",
        "providerReceipts",
        "canCancel",
        "canResume",
      ],
      "Background job",
    );
    id(job.actionId, "Action");
    id(job.operation, "Operation");
    requireTask(
      /^release-[a-f0-9]{64}$/.test(job.releaseId) &&
        JOB_STATES.includes(job.status),
      "Invalid job state.",
    );
    for (const field of ["createdAt", "updatedAt", "expiresAt"])
      time(job[field], field);
    if (job.nextAt !== null) time(job.nextAt, "Next check");
    integer(job.attempts, JOB_LIMITS.attempts, "Attempts");
    integer(job.polls, 13, "Checks");
    requireTask(
      typeof job.label === "string" &&
        job.label.length <= 200 &&
        typeof job.canCancel === "boolean" &&
        typeof job.canResume === "boolean",
      "Invalid job controls.",
    );
    requireTask(
      job.lastError === null ||
        (typeof job.lastError === "string" && job.lastError.length <= 100),
      "Invalid error.",
    );
    if (job.schedule !== null) {
      object(job.schedule, ["at", "timezone"], "Schedule");
      time(job.schedule.at, "Schedule");
      requireTask(
        typeof job.schedule.timezone === "string" &&
          job.schedule.timezone.length <= 100,
        "Invalid timezone.",
      );
    }
    list(job.providerReceipts, 4, "Provider receipts");
    for (const receipt of job.providerReceipts) {
      object(
        receipt,
        ["connectionId", "index", "provider", "id", "state", "updatedAt"],
        "Provider receipt",
      );
      id(receipt.connectionId, "Connection");
      integer(receipt.index, 3, "Step");
      time(receipt.updatedAt, "Provider observation");
      requireTask(
        receipt.provider === "resend" &&
          /^[a-f0-9-]{36}$/.test(receipt.id) &&
          [
            "accepted",
            "queued",
            "delivery_delayed",
            "delivered",
            "bounced",
            "failed",
            "suppressed",
            "complained",
          ].includes(receipt.state),
        "Invalid provider receipt.",
      );
    }
  }
  boundedJson(value, 512 * 1024, "Background jobs");
  return structuredClone(value);
}
