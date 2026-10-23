import {
  object,
  id,
  time,
  requireTask,
  boundedJson,
} from "../tasks/validation.js";
import { JOB_STATES } from "./lifecycle.js";
import { boundedValue } from "../services/values.js";
import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { canonicalJson } from "../services/json.js";

/** A receipt grants read access to one agreed public result, never to the submitted fields. */
export function parseJobReceipt(value, actionId, resultSchema) {
  object(value, ["actionId", "job"], "Job receipt");
  id(value.actionId, "Action");
  if (actionId !== undefined)
    requireTask(
      value.actionId === actionId,
      "The receipt belongs to another action.",
    );
  const job = value.job;
  object(
    job,
    ["status", "label", "updatedAt", "result", "expiresAt", "nextCheckAt"],
    "Job status",
  );
  requireTask(
    JOB_STATES.includes(job.status) &&
      typeof job.label === "string" &&
      job.label.length <= 200,
    "Invalid job status.",
  );
  time(job.updatedAt, "Receipt time");
  for (const field of ["expiresAt", "nextCheckAt"])
    if (job[field] !== null) time(job[field], field);
  if (resultSchema && (job.result !== null || job.status === "confirmed"))
    boundedValue(
      resultSchema,
      job.result,
      SERVICE_PACKAGE_LIMITS.resultBytes,
      "Job result",
    );
  boundedJson(value, SERVICE_PACKAGE_LIMITS.resultBytes + 1024, "Job receipt");
  return structuredClone(value);
}
export const receiptFinished = (value) =>
  value !== null && ["confirmed", "failed"].includes(value.job.status);
export function advanceJobReceipt(previous, next) {
  if (previous === null) return next;
  requireTask(
    next.job.updatedAt >= previous.job.updatedAt,
    "The receipt is older than the saved status.",
  );
  if (receiptFinished(previous))
    requireTask(
      next.job.status === previous.job.status &&
        canonicalJson(next.job.result) === canonicalJson(previous.job.result),
      "A completed job cannot change its result.",
    );
  requireTask(
    previous.job.status !== "pending" || next.job.status !== "received",
    "A pending job cannot return to received.",
  );
  return next;
}
