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
    this.calls = new ServiceCallQueue();
    this.controls = new ServiceControlStore(ctx.storage.sql);
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
      this.env.SERVICE_LOADER,
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
  executePackage(source, invocation, signal) {
    return executeServicePackage(
      this.env.SERVICE_LOADER,
      source,
      invocation,
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
      this.ctx.storage.transactionSync(() => {
        const service = this.store.service();
        if (
          !service ||
          service.identity.serviceId !== serviceId ||
          service.identity.ownerId !== ownerId
        )
          throw new Error("Unknown draft owner.");
        this.draftWriters.stop(taskId, this.now());
        return { stopped: true };
      }),
    );
  }
  invoke(serviceId, authority, input) {
    return hostedReply(() =>
      invokeHostedAction(this, serviceId, authority, input),
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
    return hostedReply(() =>
      controlHostedService(this, serviceId, ownerId, input),
    );
  }
  records(serviceId, ownerId) {
    return hostedReply(() =>
      this.ctx.storage.transactionSync(() =>
        inspectServiceRecords(this, serviceId, ownerId),
      ),
    );
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
  cleanupDeletedReleases() {
    for (const id of this.store.deletedIds()) {
      this.actions.clearTest(id);
      this.calls.cancel(id);
    }
  }
  async scheduleExpiry() {
    this.cleanupDeletedReleases();
    const next = this.store.nextExpiry();
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.ctx.storage.transaction(async () => {
      this.store.expire(this.now());
      await this.scheduleExpiry();
    });
  }
}
