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
import { InactiveReleaseStore } from "./releaseStore.js";

/** One independent inactive release. No HTTP entry point or platform credentials reach its code. */
export class ServiceRelease extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new InactiveReleaseStore(ctx.storage.sql);
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
    return this.ctx.storage.transactionSync(() =>
      this.store.observation(
        identity,
        this.store.current(identity, this.now()),
      ),
    );
  }
  async publish(value) {
    const publication = await verifyServicePublication(value),
      { identity } = publication;
    const body = serializeServicePublication(publication);
    return this.ctx.storage.transaction(async () => {
      const current = this.store.publish(identity, body, this.now());
      if (current.body !== null)
        await this.ctx.storage.setAlarm(identity.expiresAt);
      return this.store.observation(identity, current);
    });
  }
  async cancel(value) {
    const identity = await this.verifyIdentity(value);
    return this.ctx.storage.transaction(async () => {
      this.store.cancel(identity, this.now());
      await this.ctx.storage.deleteAlarm();
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
    if (this.store.current(identity, this.now())?.body === null)
      throw new HttpError(410, "Inactive service was cancelled.");
    return result;
  }
  async alarm() {
    const row = this.store.row();
    if (!row) return;
    const identity = JSON.parse(row.identity);
    if (this.now() < identity.expiresAt) {
      await this.ctx.storage.setAlarm(identity.expiresAt);
      return;
    }
    await this.cancel(identity);
  }
}
