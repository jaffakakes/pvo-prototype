import { DurableObject } from "cloudflare:workers";

const DAY = 86_400_000;
const JOB_LIFETIME = 60_000;
const MAX_DAILY_MESSAGES = 10;

/** A single small queue for the opt-in beta test, with no retained phone after claim. */
export class IMessageTestQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, phone TEXT NOT NULL, recipient_key TEXT NOT NULL, expires INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, recipient_key TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS counts (day INTEGER PRIMARY KEY, total INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS heartbeat (id INTEGER PRIMARY KEY, seen INTEGER NOT NULL)");
  }

  async status() {
    const seen = this.ctx.storage.sql.exec("SELECT seen FROM heartbeat WHERE id = 1").toArray()[0]?.seen ?? 0;
    return { online: Date.now() - seen < 10_000 };
  }

  async enqueue(phone, recipientKey) {
    const now = Date.now();
    const day = Math.floor(now / DAY);
    const id = crypto.randomUUID();
    const result = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const seen = sql.exec("SELECT seen FROM heartbeat WHERE id = 1").toArray()[0]?.seen ?? 0;
      if (now - seen >= 10_000) return { status: "offline" };
      const total = sql.exec("SELECT total FROM counts WHERE day = ?", day).toArray()[0]?.total ?? 0;
      if (total >= MAX_DAILY_MESSAGES) return { status: "limit" };
      sql.exec("INSERT INTO counts (day, total) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET total = total + 1", day, 1);
      sql.exec("INSERT INTO jobs (id, phone, recipient_key, expires) VALUES (?, ?, ?, ?)", id, phone, recipientKey, now + JOB_LIFETIME);
      sql.exec("INSERT INTO results (id, recipient_key, status, created) VALUES (?, ?, 'pending', ?)", id, recipientKey, now);
      return { status: "queued", id };
    });
    if (result.status === "queued") {
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > now + JOB_LIFETIME)
        await this.ctx.storage.setAlarm(now + JOB_LIFETIME);
    }
    return result;
  }

  async claim() {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec("INSERT OR REPLACE INTO heartbeat (id, seen) VALUES (1, ?)", now);
      sql.exec("UPDATE results SET status = 'expired' WHERE id IN (SELECT id FROM jobs WHERE expires <= ?)", now);
      sql.exec("DELETE FROM jobs WHERE expires <= ?", now);
      const job = sql.exec("SELECT id, phone FROM jobs ORDER BY expires, id LIMIT 1").toArray()[0];
      if (!job) return null;
      sql.exec("DELETE FROM jobs WHERE id = ?", job.id);
      sql.exec("UPDATE results SET status = 'claimed' WHERE id = ?", job.id);
      return { id: job.id, phone: job.phone };
    });
  }

  async finish(id, sent) {
    const sql = this.ctx.storage.sql;
    const current = sql.exec("SELECT status FROM results WHERE id = ?", id).toArray()[0];
    if (current?.status !== "claimed") return false;
    sql.exec("UPDATE results SET status = ? WHERE id = ?", sent ? "sent" : "failed", id);
    return true;
  }

  async result(id) {
    return this.ctx.storage.sql.exec("SELECT status FROM results WHERE id = ?", id).toArray()[0]?.status ?? null;
  }

  async alarm() {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("UPDATE results SET status = 'expired' WHERE id IN (SELECT id FROM jobs WHERE expires <= ?)", now);
    sql.exec("DELETE FROM jobs WHERE expires <= ?", now);
    sql.exec("DELETE FROM results WHERE created < ?", now - DAY);
    sql.exec("DELETE FROM counts WHERE day < ?", Math.floor(now / DAY) - 1);
    const next = sql.exec("SELECT MIN(expires) AS expiry FROM jobs").toArray()[0]?.expiry;
    if (next !== null && next !== undefined) await this.ctx.storage.setAlarm(next);
  }
}
