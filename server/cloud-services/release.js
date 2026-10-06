import { DurableObject } from "cloudflare:workers";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";
import { HttpError } from "../http.js";
import {
  INACTIVE_SERVICE_LIMITS,
  parseServiceIdentity,
  sameServiceIdentity,
} from "../../packages/pvo-assistant/releases/index.js";
import {
  serviceResourceId,
  verifyServicePublication,
} from "./releaseContract.js";
import { probeInactiveService } from "./inactiveExecution.js";

/** One independent inactive release. No HTTP entry point or platform credentials reach its code. */
export class ServiceRelease extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS release (id INTEGER PRIMARY KEY CHECK (id = 1), identity TEXT NOT NULL, source TEXT, probes INTEGER NOT NULL DEFAULT 0)",
    );
  }
  now() {
    return Date.now();
  }
  row() {
    return this.ctx.storage.sql
      .exec("SELECT identity, source, probes FROM release WHERE id = 1")
      .toArray()[0];
  }

  current(identity) {
    const stored = this.row();
    if (!stored) return null;
    if (!sameServiceIdentity(JSON.parse(stored.identity), identity))
      throw new HttpError(
        409,
        "Service ownership or immutable contents conflict.",
      );
    if (this.now() >= identity.expiresAt && stored.source !== null) {
      this.ctx.storage.sql.exec(
        "UPDATE release SET source = NULL WHERE id = 1",
      );
      stored.source = null;
    }
    return stored;
  }
  observation(identity, row) {
    return {
      identity,
      state: !row ? "missing" : row.source === null ? "deleted" : "available",
    };
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
      this.observation(identity, this.current(identity)),
    );
  }
  async publish(value) {
    const publication = await verifyServicePublication(value);
    const { identity, source } = publication;
    return this.ctx.storage.transaction(async () => {
      let current = this.current(identity);
      if (!current) {
        if (identity.expiresAt > this.now() + TASK_LIMITS.lifetimeMs)
          throw new HttpError(400, "Inactive service lifetime exceeded.");
        this.ctx.storage.sql.exec(
          "INSERT INTO release (id, identity, source) VALUES (1, ?, ?)",
          JSON.stringify(identity),
          this.now() < identity.expiresAt ? source : null,
        );
        current = this.row();
      } else if (current.source !== null && current.source !== source)
        throw new HttpError(409, "Published source cannot be replaced.");
      if (current.source !== null)
        await this.ctx.storage.setAlarm(identity.expiresAt);
      return this.observation(identity, current);
    });
  }
  async cancel(value) {
    const identity = await this.verifyIdentity(value);
    return this.ctx.storage.transaction(async () => {
      this.current(identity);
      // Retain a tiny tombstone even when publish has not arrived yet. Late calls cannot resurrect it.
      this.ctx.storage.sql.exec(
        "INSERT INTO release (id, identity, source) VALUES (1, ?, NULL) ON CONFLICT(id) DO UPDATE SET source = NULL",
        JSON.stringify(identity),
      );
      await this.ctx.storage.deleteAlarm();
      return { identity, state: "deleted" };
    });
  }
  async probe(value, input) {
    const identity = await this.verifyIdentity(value);
    const publication = this.ctx.storage.transactionSync(() => {
      const row = this.current(identity);
      if (!row || row.source === null)
        throw new HttpError(404, "Inactive service is unavailable.");
      if (row.probes >= INACTIVE_SERVICE_LIMITS.probes)
        throw new HttpError(429, "Inactive service probe limit reached.");
      this.ctx.storage.sql.exec(
        "UPDATE release SET probes = probes + 1 WHERE id = 1",
      );
      return { identity, source: row.source };
    });
    const result = await probeInactiveService(
      this.env.SERVICE_LOADER,
      publication,
      input,
    );
    if (this.current(identity)?.source === null)
      throw new HttpError(410, "Inactive service was cancelled.");
    return result;
  }
  async alarm() {
    const row = this.row();
    if (!row) return;
    const identity = JSON.parse(row.identity);
    if (this.now() < identity.expiresAt) {
      await this.ctx.storage.setAlarm(identity.expiresAt);
      return;
    }
    await this.cancel(identity);
  }
}
