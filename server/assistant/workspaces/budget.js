import { DurableObject } from "cloudflare:workers";
import {
  parseWorkspaceLease,
  WORKSPACE_LIMITS as limits,
} from "../../../packages/pvo-assistant/workspaces/index.js";

const DAY = 86_400_000;
const sameLease = (a, b) => Object.keys(a).every((key) => a[key] === b[key]);

/** A single named object owns concurrency across owners and UTC day boundaries. */
export class WorkspaceBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS workspace_grants (id TEXT PRIMARY KEY, body TEXT NOT NULL, released INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_usage (day INTEGER PRIMARY KEY, count INTEGER NOT NULL);
    `);
  }
  now() {
    return Date.now();
  }
  prune(now) {
    const sql = this.ctx.storage.sql;
    // An expired but unconfirmed resource still occupies its slot.
    sql.exec(
      "DELETE FROM workspace_grants WHERE released=1 AND expires<=?",
      now,
    );
    sql.exec("DELETE FROM workspace_usage WHERE day<?", Math.floor(now / DAY));
  }
  async reserve(value) {
    const lease = parseWorkspaceLease(value);
    const now = this.now();
    const accepted = this.ctx.storage.transactionSync(() => {
      this.prune(now);
      const sql = this.ctx.storage.sql;
      const prior = sql
        .exec(
          "SELECT body, released FROM workspace_grants WHERE id=?",
          lease.id,
        )
        .toArray()[0];
      if (prior) {
        if (!sameLease(JSON.parse(prior.body), lease))
          throw new Error("Workspace lease conflict.");
        return !prior.released && now < lease.deadlineAt;
      }
      if (lease.startedAt > now || now >= lease.deadlineAt) return false;
      if (
        sql.exec("SELECT COUNT(*) AS count FROM workspace_grants").one()
          .count >= 4096
      )
        return false;
      if (
        sql
          .exec(
            "SELECT COUNT(*) AS count FROM workspace_grants WHERE released=0",
          )
          .one().count >= limits.concurrent
      )
        return false;
      const day = Math.floor(now / DAY);
      const used =
        sql
          .exec("SELECT count FROM workspace_usage WHERE day=?", day)
          .toArray()[0]?.count ?? 0;
      if (used >= limits.dailySessions) return false;
      sql.exec(
        "INSERT INTO workspace_grants (id,body,released,expires) VALUES (?,?,0,?)",
        lease.id,
        JSON.stringify(lease),
        lease.expiresAt,
      );
      sql.exec(
        "INSERT INTO workspace_usage (day,count) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET count=count+1",
        day,
      );
      return true;
    });
    await this.schedule();
    return accepted;
  }
  async release(value) {
    const lease = parseWorkspaceLease(value);
    this.ctx.storage.transactionSync(() => {
      this.prune(this.now());
      const sql = this.ctx.storage.sql;
      const prior = sql
        .exec("SELECT body FROM workspace_grants WHERE id=?", lease.id)
        .toArray()[0];
      if (prior && !sameLease(JSON.parse(prior.body), lease))
        throw new Error("Workspace lease conflict.");
      if (!prior && this.now() >= lease.expiresAt) return;
      if (
        !prior &&
        sql.exec("SELECT COUNT(*) AS count FROM workspace_grants").one()
          .count >= 4096
      )
        throw new Error("Workspace reservation journal is full.");
      // Also record release before a delayed reserve arrives; it cannot reopen.
      sql.exec(
        "INSERT INTO workspace_grants (id,body,released,expires) VALUES (?,?,1,?) ON CONFLICT(id) DO UPDATE SET released=1",
        lease.id,
        JSON.stringify(lease),
        lease.expiresAt,
      );
    });
    await this.schedule();
    return true;
  }
  async schedule() {
    const next = this.ctx.storage.sql
      .exec(
        "SELECT MIN(expires) AS next FROM workspace_grants WHERE released=1",
      )
      .one().next;
    if (next !== null)
      await this.ctx.storage.setAlarm(Math.max(this.now() + 1000, next));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    this.ctx.storage.transactionSync(() => this.prune(this.now()));
    await this.schedule();
  }
}
