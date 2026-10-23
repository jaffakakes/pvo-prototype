import {
  parseJobRequest,
  createJob,
  requireJobKey,
  viewerJobReceipt,
  settleJob,
} from "../../../packages/pvo-assistant/jobs/index.js";
import {
  serviceCallError,
  prepareHostedInvocation,
} from "../../../packages/pvo-assistant/hosting/index.js";
import { parseServicePublication } from "../../../packages/pvo-assistant/releases/index.js";
import { canonicalJson } from "../../../packages/pvo-assistant/services/json.js";
import { contentDigest } from "../../contentDigest.js";
import { ownedHost } from "../ownership.js";
import {
  object,
  id,
  requireTask,
} from "../../../packages/pvo-assistant/tasks/validation.js";

export async function acceptServiceJob(host, serviceId, raw) {
  let request;
  try {
    request = parseJobRequest(raw, host.now());
  } catch {
    throw serviceCallError(
      "invalid_input",
      "Invalid background request or schedule.",
    );
  }
  const viewerHash = await contentDigest(request.receiptKey);
  const inputDigest = await contentDigest(
    canonicalJson({
      action: request.action,
      releaseId: request.releaseId,
      schedule: request.schedule,
    }),
  );
  return host.ctx.storage.transaction(async () => {
    const previous = host.jobs.get(request.action.actionId);
    if (previous) {
      requireJobKey(previous, viewerHash);
      if (previous.inputDigest !== inputDigest)
        throw serviceCallError(
          "action_conflict",
          "This request already has different input.",
        );
      await host.scheduleExpiry();
      return viewerJobReceipt(previous);
    }
    const service = host.store.service();
    if (request.schedule && request.schedule.at < host.now())
      throw serviceCallError(
        "invalid_input",
        "Choose a future scheduled time.",
      );
    if (
      !service ||
      service.identity.serviceId !== serviceId ||
      service.state !== "active" ||
      service.liveReleaseId !== request.releaseId
    )
      throw serviceCallError(
        "unavailable",
        "This Container is not accepting this version's requests.",
      );
    const row = host.store.row(request.releaseId);
    if (!row?.body)
      throw serviceCallError("unavailable", "This version is unavailable.");
    const publication = parseServicePublication(JSON.parse(row.body));
    const operation = publication.artifact.agreement.operations.find(
      (item) => item.name === request.action.operation,
    );
    if (operation?.delivery !== "background")
      throw serviceCallError(
        "forbidden",
        "This operation does not accept background work.",
      );
    // Validate public input and release approval before committing acceptance; generated code has not run.
    prepareHostedInvocation(
      publication.artifact.agreement,
      request.action,
      host.actions.data("live", publication.artifact.agreement.state.initial)
        .state,
      host.now(),
      "public",
    );
    host.accounts.requireApproval(
      request.releaseId,
      publication.artifact.agreement.connections,
    );
    if (host.actions.receipt("live", request.action.actionId))
      throw serviceCallError(
        "action_conflict",
        "This identity was already used by an immediate action.",
      );
    host.jobs.expire(host.now());
    const job = host.jobs.insert(
      createJob(service.identity, request, inputDigest, viewerHash, host.now()),
      host.now(),
    );
    // The durable alarm is committed before the HTTP request is acknowledged.
    await host.scheduleExpiry();
    return viewerJobReceipt(job);
  });
}

export async function readServiceJob(host, serviceId, raw) {
  try {
    object(raw, ["actionId", "receiptKey"], "Receipt request");
    id(raw.actionId, "Receipt");
    requireTask(/^[a-f0-9]{64}$/.test(raw.receiptKey), "Invalid receipt key.");
  } catch {
    throw serviceCallError("invalid_input", "Invalid receipt request.");
  }
  const hash = await contentDigest(raw.receiptKey);
  const job = host.jobs.get(raw.actionId);
  requireJobKey(job?.serviceId === serviceId ? job : null, hash);
  if (job.purgeAt !== null && job.purgeAt <= host.now())
    throw serviceCallError("unavailable", "This receipt has expired.");
  return viewerJobReceipt(job);
}

export async function manageServiceJob(host, serviceId, ownerId, raw) {
  ownedHost(host, serviceId, ownerId);
  try {
    object(raw, ["actionId", "kind"], "Job control");
    id(raw.actionId, "Job");
    requireTask(["cancel", "resume"].includes(raw.kind), "Invalid control.");
  } catch {
    throw serviceCallError("invalid_input", "Invalid background control.");
  }
  return host.ctx.storage.transaction(async () => {
    const job = host.jobs.get(raw.actionId);
    if (!job) throw serviceCallError("unavailable", "This job is unavailable.");
    if (raw.kind === "cancel") {
      if (
        job.executionDone ||
        job.providerReceipts.length > 0 ||
        job.claim ||
        host.accounts.pending("live")?.action.actionId === job.id
      )
        throw serviceCallError(
          "needs_checking",
          "This action may already have started. Check its saved result before cancelling.",
        );
      if (["received", "pending"].includes(job.status))
        host.jobs.save({
          ...settleJob(job, "failed", "cancelled", host.now()),
          cancelledAt: host.now(),
        });
    } else if (job.status === "needs_checking") {
      const service = host.store.service();
      if (service.state !== "active" || service.liveReleaseId !== job.releaseId)
        throw serviceCallError(
          "unavailable",
          "Resume the original Container version first.",
        );
      // The existing outside-request journal only reconciles a previously dispatched write.
      host.jobs.save({
        ...job,
        status: "pending",
        attempts: 0,
        polls: 0,
        claim: null,
        nextAt: host.now(),
        expiresAt: host.now() + 86400000,
        updatedAt: host.now(),
      });
    }
    await host.scheduleExpiry();
    return viewerJobReceipt(host.jobs.get(job.id));
  });
}
