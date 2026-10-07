import { parseNodeBundle } from "../../../packages/pvo-assistant/services/index.js";
import { DurableObject } from "cloudflare:workers";
import { NodeContainer, nodeExecutionError } from "./container.js";
import { NODE_LIMITS as limits } from "./runtime.js";
import { withAssistantDeadline } from "../../assistant/deadline.js";

const DAY = 86400000;
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** A bounded execution slot owns compute only. Drafts, releases, records and action receipts live elsewhere. */
export class ServiceNodeExecution extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.native = this.containerAdapter();
    this.active = null;
    this.cleaning = null;
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS node_lease(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS node_usage(day INTEGER NOT NULL,owner_id TEXT NOT NULL,service_id TEXT NOT NULL,mode TEXT NOT NULL,starts INTEGER NOT NULL,milliseconds INTEGER NOT NULL,PRIMARY KEY(day,owner_id,service_id,mode));
      CREATE TABLE IF NOT EXISTS node_receipts(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS node_start_fence(id INTEGER PRIMARY KEY CHECK(id=1),expires_at INTEGER NOT NULL);`);
  }
  now() {
    return Date.now();
  }
  containerAdapter() {
    return new NodeContainer(this.ctx.container);
  }
  lease() {
    const row = this.ctx.storage.sql
      .exec("SELECT body FROM node_lease WHERE id=1")
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  save(lease) {
    this.ctx.storage.sql.exec(
      "INSERT INTO node_lease(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      JSON.stringify(lease),
    );
  }
  remember(id) {
    const sql = this.ctx.storage.sql,
      now = this.now();
    sql.exec("DELETE FROM node_receipts WHERE expires_at<=?", now);
    const prior = sql
      .exec("SELECT id FROM node_receipts WHERE id=?", id)
      .toArray().length;
    if (
      prior ||
      sql.exec("SELECT COUNT(*) AS count FROM node_receipts").one().count < 1024
    )
      sql.exec(
        "INSERT OR REPLACE INTO node_receipts(id,expires_at) VALUES(?,?)",
        id,
        now + limits.leaseMs,
      );
    else
      // Bound cancellation tombstones without admitting a delayed cancelled request after eviction.
      sql.exec(
        "INSERT INTO node_start_fence(id,expires_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)",
        now + limits.leaseMs,
      );
  }
  assertCurrent(lease) {
    const actual = this.lease();
    if (
      !actual ||
      actual.id !== lease.id ||
      actual.phase !== "running" ||
      this.now() >= actual.deadlineAt
    )
      throw nodeExecutionError("execution_cancelled");
  }
  limits() {
    // Capacity per slot and UTC day, not a goal-wide model/tool-turn ceiling.
    return { platform: 500, owner: 50 };
  }
  async execute(request) {
    try {
      return { ok: true, value: await this.run(request) };
    } catch (error) {
      const codes = [
        "invalid_input",
        "input_limit",
        "execution_capacity",
        "execution_allowance",
        "execution_closed",
        "execution_cancelled",
        "runtime_unavailable",
        "startup_timeout",
        "runtime_mismatch",
        "output_limit",
        "invalid_reply",
        "cleanup_unconfirmed",
      ];
      return {
        ok: false,
        ...(error?.code === "execution_allowance"
          ? { retryAt: (Math.floor(this.now() / DAY) + 1) * DAY }
          : error?.code === "execution_capacity"
            ? { retryAt: this.lease()?.nextAt ?? this.now() + 1000 }
            : {}),
        code:
          error?.status === 504
            ? "timeout"
            : codes.includes(error?.code)
              ? error.code
              : "execution_failed",
      };
    }
  }
  async run(request) {
    if (
      !request ||
      !id(request.id) ||
      request.id.length > 64 ||
      !id(request.ownerId) ||
      !id(request.serviceId) ||
      !Number.isSafeInteger(request.expiresAt) ||
      request.expiresAt <= this.now() ||
      request.expiresAt > this.now() + limits.leaseMs ||
      !["live", "test", "validation", "probe"].includes(request.mode)
    )
      throw nodeExecutionError("invalid_input");
    const invocationBody = JSON.stringify(request.invocation);
    if (
      typeof invocationBody !== "string" ||
      new TextEncoder().encode(invocationBody).length > limits.invocationBytes
    )
      throw nodeExecutionError("input_limit");
    let bundle;
    try {
      bundle = parseNodeBundle(request.bundle);
    } catch {
      throw nodeExecutionError("invalid_input");
    }
    const now = this.now(),
      day = Math.floor(now / DAY);
    // Private callers select the owned snapshot. Guest JSON never supplies admission or lifecycle authority.
    if (
      new TextEncoder().encode(JSON.stringify(request)).length >
      limits.requestBytes
    )
      throw nodeExecutionError("input_limit");
    const lease = await this.ctx.storage.transaction(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec("DELETE FROM node_usage WHERE day<?", day - 30);
      sql.exec("DELETE FROM node_receipts WHERE expires_at<=?", now);
      if (
        this.lease() ||
        (sql
          .exec("SELECT expires_at FROM node_start_fence WHERE id=1")
          .toArray()[0]?.expires_at ?? 0) > now ||
        sql.exec("SELECT COUNT(*) AS count FROM node_receipts").one().count >=
          1024
      )
        throw nodeExecutionError("execution_capacity");
      if (
        sql
          .exec("SELECT id FROM node_receipts WHERE id=?", request.id)
          .toArray().length
      )
        throw nodeExecutionError("execution_closed");
      const counts = this.limits();
      const total = sql
        .exec(
          "SELECT COALESCE(SUM(starts),0) AS count FROM node_usage WHERE day=?",
          day,
        )
        .one().count;
      const owner = sql
        .exec(
          "SELECT COALESCE(SUM(starts),0) AS count FROM node_usage WHERE day=? AND owner_id=?",
          day,
          request.ownerId,
        )
        .one().count;
      if (total >= counts.platform || owner >= counts.owner)
        throw nodeExecutionError("execution_allowance");
      const value = {
        id: request.id,
        ownerId: request.ownerId,
        serviceId: request.serviceId,
        mode: request.mode,
        day,
        startedAt: now,
        deadlineAt: request.expiresAt,
        phase: "running",
        cleanupAttempts: 0,
        nextAt: request.expiresAt,
      };
      this.save(value);
      this.remember(value.id);
      sql.exec(
        "INSERT INTO node_usage(day,owner_id,service_id,mode,starts,milliseconds) VALUES(?,?,?,?,1,0) ON CONFLICT(day,owner_id,service_id,mode) DO UPDATE SET starts=starts+1",
        day,
        request.ownerId,
        request.serviceId,
        request.mode,
      );
      await this.ctx.storage.setAlarm(value.deadlineAt);
      return value;
    });
    const controller = new AbortController();
    this.active = { id: lease.id, controller };
    let reply,
      failure = null;
    try {
      await withAssistantDeadline(
        async (signal) => {
          this.assertCurrent(lease);
          signal.throwIfAborted();
          this.native.start(lease.id);
          await this.native.ready(() => this.assertCurrent(lease), signal);
          this.assertCurrent(lease);
          signal.throwIfAborted();
          reply = await this.native.execute(
            bundle,
            request.invocation,
            () => this.assertCurrent(lease),
            signal,
          );
          this.assertCurrent(lease);
          signal.throwIfAborted();
        },
        Math.max(1, lease.deadlineAt - this.now()),
        controller.signal,
      );
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.beginCleanup(lease.id);
        // Do not release capacity or a result until whole-guest destruction is confirmed.
        await this.cleanup(lease.id, true);
      } finally {
        if (this.active?.id === lease.id) this.active = null;
      }
    }
    if (this.lease()?.id === lease.id)
      throw nodeExecutionError("cleanup_unconfirmed");
    if (controller.signal.aborted)
      throw nodeExecutionError("execution_cancelled");
    if (failure) throw failure;
    return reply;
  }
  async beginCleanup(id) {
    return this.ctx.storage.transaction(async () => {
      const lease = this.lease();
      if (!lease || lease.id !== id) return;
      if (lease.phase === "cleanup") return;
      lease.phase = "cleanup";
      lease.nextAt = this.now();
      this.save(lease);
      await this.ctx.storage.setAlarm(lease.nextAt + 10);
    });
  }
  async cleanup(id, waitForOwnedResult = false) {
    const lease = this.lease();
    if (!lease || lease.id !== id || lease.phase !== "cleanup") return;
    if (this.cleaning) {
      const operation = this.cleaning;
      // The result path waits for an alarm's same cleanup; cancellation itself remains nonblocking.
      if (waitForOwnedResult) {
        try {
          await withAssistantDeadline(() => operation, limits.cleanupMs);
        } catch {
          /* The retained lease still fences capacity and owns cleanup retries. */
        }
      }
      if (this.lease()?.id === id)
        await this.ctx.storage.setAlarm(this.now() + 1000);
      return;
    }
    // Hold the single cleanup operation through its durable commit, not just the provider promise.
    const operation = this.destroyAndRelease(id);
    this.cleaning = operation;
    void operation
      .finally(() => {
        if (this.cleaning === operation) this.cleaning = null;
      })
      .catch(() => {});
    try {
      await withAssistantDeadline(() => operation, limits.cleanupMs);
    } catch {
      await this.ctx.storage.transaction(async () => {
        const actual = this.lease();
        if (!actual || actual.id !== id) return;
        actual.cleanupAttempts++;
        actual.nextAt =
          this.now() +
          Math.min(60000, 1000 * 2 ** Math.min(actual.cleanupAttempts, 6));
        this.save(actual);
        await this.ctx.storage.setAlarm(actual.nextAt);
      });
    }
  }
  async destroyAndRelease(id) {
    await this.native.destroy();
    await this.ctx.storage.transaction(async () => {
      const actual = this.lease();
      if (!actual || actual.id !== id || actual.phase !== "cleanup") return;
      this.ctx.storage.sql.exec(
        "UPDATE node_usage SET milliseconds=milliseconds+? WHERE day=? AND owner_id=? AND service_id=? AND mode=?",
        Math.max(0, this.now() - actual.startedAt),
        actual.day,
        actual.ownerId,
        actual.serviceId,
        actual.mode,
      );
      this.remember(id);
      this.ctx.storage.sql.exec("DELETE FROM node_lease WHERE id=1");
      await this.ctx.storage.setAlarm(this.now() + limits.leaseMs);
    });
  }
  async cancel(id) {
    if (!id || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
      throw nodeExecutionError("invalid_input");
    this.remember(id);
    const lease = this.lease();
    if (!lease || lease.id !== id) {
      if (!lease) await this.ctx.storage.setAlarm(this.now() + limits.leaseMs);
      return { closed: true };
    }
    this.active?.controller.abort();
    await this.beginCleanup(id);
    await this.cleanup(id);
    return { closed: this.lease()?.id !== id };
  }
  async alarm() {
    const lease = this.lease();
    if (!lease) {
      this.ctx.storage.sql.exec(
        "DELETE FROM node_receipts WHERE expires_at<=?",
        this.now(),
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM node_usage WHERE day<?",
        Math.floor(this.now() / DAY) - 30,
      );
      return;
    }
    if (lease.phase === "running" && this.now() < lease.deadlineAt) {
      await this.ctx.storage.setAlarm(lease.deadlineAt);
      return;
    }
    // A cleanup alarm must not cancel a successful execution already waiting for destruction.
    if (lease.phase === "running") this.active?.controller.abort();
    await this.beginCleanup(lease.id);
    await this.cleanup(lease.id);
  }
}
