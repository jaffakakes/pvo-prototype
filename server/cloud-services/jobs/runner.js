import {
  failJob,
  settleJob,
} from "../../../packages/pvo-assistant/jobs/index.js";
import {
  mergeProviderReceipts,
  settleProviderEvidence,
} from "../../../packages/pvo-assistant/jobs/provider.js";
import { pollJobProviders } from "./providerUpdates.js";
import { invokeHostedAction } from "../invocation.js";

/** Durable alarms own execution. Closing the accepting browser never cancels an accepted job. */
export async function runServiceJobs(host) {
  const service = host.store.service();
  if (service?.state !== "active") return;
  const job = host.ctx.storage.transactionSync(() =>
    host.jobs.claim(host.now(), crypto.randomUUID()),
  );
  if (!job) return;
  // Save the recovery alarm before the first execution await. A stale worker cannot settle a newer claim.
  await host.scheduleExpiry();
  let outcome;
  try {
    if (job.executionDone) outcome = await pollJobProviders(host, job);
    else if (service.liveReleaseId !== job.releaseId)
      outcome = settleJob(job, "failed", "version_changed", host.now());
    else {
      const result = await invokeHostedAction(
        host,
        job.serviceId,
        { kind: "public", jobId: job.id },
        job.action,
      );
      const current = {
        ...host.jobs.get(job.id),
        executionDone: true,
        claim: null,
        result: result.result,
      };
      outcome = current.providerReceipts.length
        ? {
            ...current,
            status: "pending",
            nextAt: host.now() + 60000,
            updatedAt: host.now(),
          }
        : settleJob(current, "confirmed", null, host.now(), result.result);
    }
  } catch (error) {
    const pending = host.accounts.pending("live");
    outcome = job.executionDone
      ? job.polls + 1 >= 12
        ? settleJob(
            { ...job, polls: job.polls + 1 },
            "needs_checking",
            "delivery_unconfirmed",
            host.now(),
            job.result,
          )
        : {
            ...job,
            claim: null,
            polls: job.polls + 1,
            nextAt: host.now() + 300000,
            lastError: "status_unavailable",
            updatedAt: host.now(),
          }
      : failJob(
          job,
          error?.code,
          pending?.action.actionId === job.id && pending.writeStarted,
          host.now(),
        );
  }
  await host.ctx.storage.transaction(async () => {
    const current = host.jobs.get(job.id);
    if (current?.claim?.id === job.claim.id)
      host.jobs.save(
        settleProviderEvidence(
          {
            ...outcome,
            providerReceipts: mergeProviderReceipts(
              current.providerReceipts,
              outcome.providerReceipts,
            ),
          },
          host.now(),
        ),
      );
    await host.scheduleExpiry();
  });
}
