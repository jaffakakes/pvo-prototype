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
    this.actions = new ServiceActionStore(ctx.storage.sql);
    this.calls = new ServiceCallQueue();
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
      await this.scheduleExpiry();
      return this.store.observation(identity, current);
    });
  }
  async cancel(value) {
    const identity = await this.verifyIdentity(value);
    return this.ctx.storage.transaction(async () => {
      this.store.cancel(identity, this.now());
      this.actions.clearTest(identity.resourceId);
      this.calls.cancel(identity.resourceId);
      await this.scheduleExpiry();
      return { identity, state: "deleted" };
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
  async invoke(serviceId, authority, input) {
    try {
      return {
        ok: true,
        value: await invokeHostedAction(this, serviceId, authority, input),
      };
    } catch (error) {
      const codes = {
        unavailable: 404,
        forbidden: 403,
        invalid_input: 400,
        action_conflict: 409,
        state_changed: 409,
        budget_exceeded: 429,
        busy: 429,
        invalid_result: 502,
      };
      const status = codes[error?.code] ?? 502;
      return {
        ok: false,
        status,
        error: codes[error?.code]
          ? error.message
          : "This service could not complete the action. Retry the same action.",
      };
    }
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
