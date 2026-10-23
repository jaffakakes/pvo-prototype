import { settleJob } from "../../../packages/pvo-assistant/jobs/index.js";
import {
  applyProviderUpdate,
  providerComplete,
} from "../../../packages/pvo-assistant/jobs/provider.js";
import { accountCommand } from "../accountAccess.js";

export function recordJobProvider(
  host,
  actionId,
  connectionId,
  index,
  provider,
  result,
) {
  if (provider !== "resend") return;
  const job = host.jobs.get(actionId);
  if (!job) return;
  if (!/^[a-f0-9-]{36}$/.test(result?.id))
    throw new Error("The email provider did not return a receipt.");
  const previous = job.providerReceipts.find(
    (receipt) => receipt.index === index,
  );
  if (previous) {
    if (previous.id !== result.id || previous.connectionId !== connectionId)
      throw new Error("The saved provider receipt changed.");
    return;
  }
  host.jobs.save({
    ...job,
    providerReceipts: [
      ...job.providerReceipts,
      {
        connectionId,
        index,
        provider,
        id: result.id,
        state: "accepted",
        updatedAt: host.now(),
      },
    ],
  });
}

export async function pollJobProviders(host, job) {
  let next = job;
  for (const receipt of job.providerReceipts) {
    if (providerComplete(receipt.state)) continue;
    const result = await accountCommand(host, "service_status", {
      serviceId: job.serviceId,
      actionId: job.id,
      index: receipt.index,
      connectionId: receipt.connectionId,
      emailId: receipt.id,
    });
    next = applyProviderUpdate(
      next,
      receipt.connectionId,
      receipt.id,
      result.event,
      result.at,
      host.now(),
    );
  }
  if (next.status === "pending") {
    if (next.polls + 1 >= 12)
      return settleJob(
        { ...next, polls: next.polls + 1 },
        "needs_checking",
        "delivery_unconfirmed",
        host.now(),
        next.result,
      );
    next = {
      ...next,
      claim: null,
      polls: next.polls + 1,
      nextAt:
        host.now() + Math.min(3600000, 60000 * 2 ** Math.min(next.polls, 5)),
    };
  }
  return next;
}

export async function receiveJobProviderEvent(
  host,
  serviceId,
  connectionId,
  body,
  headers,
) {
  if (host.store.service()?.identity.serviceId !== serviceId)
    throw new Error("Unknown Container.");
  const event = await accountCommand(host, "service_event", {
    connectionId,
    body,
    headers,
  });
  return host.ctx.storage.transaction(async () => {
    const matches = host.jobs
      .all()
      .filter((job) =>
        job.providerReceipts.some(
          (receipt) =>
            receipt.connectionId === connectionId &&
            receipt.id === event.emailId,
        ),
      );
    if (matches.length !== 1) return { recorded: false };
    const job = matches[0];
    if (host.jobs.eventSeen(event.eventId)) return { recorded: true };
    host.jobs.save(
      applyProviderUpdate(
        job,
        connectionId,
        event.emailId,
        event.event,
        event.at,
        host.now(),
      ),
    );
    host.jobs.saveEvent(event.eventId, job.id);
    await host.scheduleExpiry();
    return { recorded: true };
  });
}
