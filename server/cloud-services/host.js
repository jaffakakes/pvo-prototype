import { inspectServiceMaintenance } from "./maintenance.js";
import { creatorJobSummary } from "../../packages/pvo-assistant/jobs/index.js";
import { ServiceAccountStore } from "./accountStore.js";
import { receiveJobProviderEvent } from "./jobs/providerUpdates.js";
import { ServiceJobStore } from "./jobs/store.js";
import {
  acceptServiceJob,
  readServiceJob,
  manageServiceJob,
} from "./jobs/commands.js";
import { runServiceJobs } from "./jobs/runner.js";
import { accountCommand, serviceAccountAccess } from "./accountAccess.js";
import { ownedHost } from "./ownership.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";
import { ServiceConnectionStore } from "./connectionStore.js";
import {
  inspectServiceConnections,
  reportServiceConnections,
  recordServicePublication,
} from "./connections.js";
import { DraftWriters } from "./draftWriters.js";
import { inspectServiceRecords } from "./records.js";
import {
  publishedServiceOperations,
  resolvePublishedAttachment,
} from "./attachments.js";
import { ServiceDraftStore } from "./draftStore.js";
import {
  readHostedDraft,
  saveHostedDraft,
  initializeHostedDraft,
} from "./drafts.js";
import { ServiceControlStore } from "./controlStore.js";
import { inspectHostedService, controlHostedService } from "./control.js";
import { hostedReply } from "./rpcReply.js";
import { ServiceActionStore } from "./actionStore.js";
import { ServiceCallQueue } from "./callQueue.js";
import { invokeHostedAction } from "./invocation.js";
import { executeServicePackage } from "./packageExecution.js";
import { DurableObject } from "cloudflare:workers";
import { HttpError } from "../http.js";
import {
  parseServiceIdentity,
  serializeServicePublication,
} from "../../packages/pvo-assistant/releases/index.js";
import {
  serviceResourceId,
  verifyServicePublication,
} from "./releaseContract.js";
import { probeInactiveService } from "./inactiveExecution.js";
import { ServiceReleaseStore } from "./releaseStore.js";

/** One stable service with independent immutable releases. No HTTP entry point or platform credentials reach its code. */
export class HostedService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new ServiceReleaseStore(ctx.storage.sql);
    this.drafts = new ServiceDraftStore(ctx.storage.sql);
    this.draftWriters = new DraftWriters(ctx.storage.sql);
    this.actions = new ServiceActionStore(ctx.storage.sql);
    this.accounts = new ServiceAccountStore(ctx.storage.sql);
    this.jobs = new ServiceJobStore(ctx.storage.sql);
    this.calls = new ServiceCallQueue();
    this.controls = new ServiceControlStore(ctx.storage.sql);
    this.connections = new ServiceConnectionStore(ctx.storage.sql);
  }
  now() {
    return Date.now();
  }
  async verifyIdentity(value) {
    const identity = parseServiceIdentity(value);
    if ((await serviceResourceId(identity)) !== identity.resourceId)
      throw new HttpError(400, "Invalid service identity.");
    return identity;
  }
  async lookup(value) {
    const identity = await this.verifyIdentity(value);
    return this.ctx.storage.transactionSync(() => {
      const current = this.store.current(identity, this.now());
      this.cleanupDeletedReleases();
      return this.store.observation(identity, current);
    });
  }
  async publish(value) {
    const publication = await verifyServicePublication(value),
      { identity } = publication;
    const body = serializeServicePublication(publication);
    return this.ctx.storage.transaction(async () => {
      const current = this.store.publish(identity, body, this.now());
      if (current.body !== null) {
        const { agreement, package: source } = publication.artifact;
        this.drafts.initialize(
          this.store.service().identity,
          {
            description: agreement.description,
            agreement,
            entrypoint: source.entrypoint,
            files: source.files,
            tests: source.tests,
            dependencies: source.dependencies,
          },
          this.now(),
        );
      }

      await this.scheduleExpiry();
      return this.store.observation(identity, current);
    });
  }
  async cancel(value) {
    const identity = await this.verifyIdentity(value);
    return this.ctx.storage.transaction(async () => {
      this.store.cancel(identity, this.now());
      await this.scheduleExpiry();
      return this.store.observation(
        identity,
        this.store.row(identity.resourceId),
      );
    });
  }
  async probe(value, input) {
    const identity = await this.verifyIdentity(value);
    const publication = this.ctx.storage.transactionSync(() =>
      this.store.consumeProbe(identity, this.now()),
    );
    const result = await probeInactiveService(
      this.env.SERVICE_NODE_EXECUTION,
      publication,
      input,
      this.now(),
    );
    const current = this.store.current(identity, this.now());
    this.cleanupDeletedReleases();
    if (current?.body === null)
      throw new HttpError(410, "Inactive service was cancelled.");
    return result;
  }
  executePackage(source, invocation, mode, signal) {
    const { ownerId, serviceId } = this.store.service().identity;
    return executeServicePackage(
      this.env.SERVICE_NODE_EXECUTION,
      source,
      invocation,
      { ownerId, serviceId, mode },
      signal,
    );
  }
  initializeDraft(identity, description) {
    return hostedReply(() =>
      initializeHostedDraft(this, identity, description),
    );
  }
  readDraft(serviceId, ownerId) {
    return hostedReply(() => readHostedDraft(this, serviceId, ownerId));
  }
  saveDraft(serviceId, ownerId, input) {
    return hostedReply(() => saveHostedDraft(this, serviceId, ownerId, input));
  }
  saveTaskDraft(serviceId, ownerId, input, grant) {
    return hostedReply(() =>
      saveHostedDraft(this, serviceId, ownerId, input, grant),
    );
  }
  stopDraftTask(serviceId, ownerId, taskId) {
    return hostedReply(() =>
      this.ctx.storage.transaction(async () => {
        const service = this.store.service();
        if (
          !service ||
          service.identity.serviceId !== serviceId ||
          service.identity.ownerId !== ownerId
        )
          throw new Error("Unknown draft owner.");
        this.draftWriters.stop(taskId, this.now());
        await this.scheduleExpiry();
        return { stopped: true };
      }),
    );
  }
  invoke(serviceId, authority, input) {
    return hostedReply(() =>
      invokeHostedAction(this, serviceId, authority, input),
    );
  }
  providerEvent(serviceId, connectionId, body, headers) {
    return hostedReply(() =>
      receiveJobProviderEvent(this, serviceId, connectionId, body, headers),
    );
  }
  acceptJob(serviceId, input) {
    return hostedReply(() => acceptServiceJob(this, serviceId, input));
  }
  jobReceipt(serviceId, input) {
    return hostedReply(() => readServiceJob(this, serviceId, input));
  }
  manageJob(serviceId, ownerId, input) {
    return hostedReply(() => manageServiceJob(this, serviceId, ownerId, input));
  }
  listJobs(serviceId, ownerId) {
    return hostedReply(() => {
      ownedHost(this, serviceId, ownerId);
      return {
        ownerId,
        serviceId,
        observedAt: this.now(),
        jobs: this.jobs.all().map(creatorJobSummary),
      };
    });
  }
  maintenance(serviceId, ownerId) {
    return hostedReply(() =>
      inspectServiceMaintenance(this, serviceId, ownerId),
    );
  }
  inspect(serviceId, ownerId) {
    return hostedReply(() =>
      this.ctx.storage.transactionSync(() =>
        inspectHostedService(this, serviceId, ownerId),
      ),
    );
  }
  control(serviceId, ownerId, input) {
    return hostedReply(async () => {
      const result = await controlHostedService(
        this,
        serviceId,
        ownerId,
        input,
      );
      if (
        input.kind === "delete" &&
        typeof this.env.ASSISTANT_TASKS?.getByName === "function"
      )
        await accountCommand(this, "service_forget", { serviceId });
      return result;
    });
  }
  resumeAccountAction(serviceId, ownerId, actionId) {
    return hostedReply(async () => {
      ownedHost(this, serviceId, ownerId);
      const pending = this.accounts.pending("live");
      if (!pending || pending.action.actionId !== actionId)
        throw serviceCallError(
          "unavailable",
          "This saved action is unavailable.",
        );
      return invokeHostedAction(
        this,
        serviceId,
        { kind: "creator", ownerId, mode: "live" },
        pending.action,
      );
    });
  }
  accountAccess(serviceId, ownerId, input) {
    return hostedReply(() =>
      serviceAccountAccess(this, serviceId, ownerId, input),
    );
  }
  records(serviceId, ownerId) {
    return hostedReply(() => inspectServiceRecords(this, serviceId, ownerId));
  }
  operations(serviceId, ownerId) {
    return hostedReply(() =>
      this.ctx.storage.transactionSync(() =>
        publishedServiceOperations(this, serviceId, ownerId),
      ),
    );
  }
  attachment(serviceId, ownerId, input) {
    return hostedReply(() =>
      this.ctx.storage.transactionSync(() =>
        resolvePublishedAttachment(this, serviceId, ownerId, input),
      ),
    );
  }
  connectionReport(serviceId, ownerId, value = null) {
    return hostedReply(() =>
      this.ctx.storage.transactionSync(() =>
        value === null
          ? inspectServiceConnections(this, serviceId, ownerId)
          : reportServiceConnections(this, serviceId, ownerId, value),
      ),
    );
  }
  recordPublication(serviceId, ownerId, exportId, publication) {
    return hostedReply(() =>
      this.ctx.storage.transactionSync(() =>
        recordServicePublication(
          this,
          serviceId,
          ownerId,
          exportId,
          publication,
        ),
      ),
    );
  }
  cleanupDeletedReleases() {
    for (const id of this.store.deletedIds()) {
      this.actions.clearTest(id);
      if (this.accounts.approval(id)) this.accounts.revoke(id);
      this.calls.cancel(id);
    }
  }
  async scheduleExpiry() {
    this.cleanupDeletedReleases();
    this.draftWriters.expire(this.now());
    const times = [
      this.store.nextExpiry(),
      this.draftWriters.nextExpiry(),
      this.jobs.nextAt(this.now(), this.store.service()?.state === "active"),
    ].filter((at) => at !== null);
    const next = times.length ? Math.min(...times) : null;
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.ctx.storage.transaction(async () => {
      this.store.expire(this.now());
      this.jobs.expire(this.now());
      await this.scheduleExpiry();
    });
    await runServiceJobs(this);
  }
}
