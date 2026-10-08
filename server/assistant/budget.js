import { DurableObject } from "cloudflare:workers";
import { assistantDailyCapacity } from "./dailyCapacity.js";

const validKey = (key) => typeof key === "string" && /^[a-f0-9]{64}$/.test(key);

// One object coordinates a UTC day's inference allowance across foreground and saved work.
export class AssistantBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS counts (key TEXT PRIMARY KEY, total INTEGER NOT NULL, minute INTEGER NOT NULL, burst INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, client TEXT NOT NULL, minute INTEGER NOT NULL, state TEXT NOT NULL)`);
  }

  now() {
    return Date.now();
  }

  dailyLimits() {
    return assistantDailyCapacity(
      this.env.ASSISTANT_DAILY_CAPACITY,
      this.now(),
    );
  }

  async reserve(key, operationKey = null) {
    if (!validKey(key) || (operationKey !== null && !validKey(operationKey)))
      return false;
    return (await this.reserveDecision(key, operationKey)).accepted;
  }

  // Saved goals need a trusted reason and wakeup time; foreground keeps its boolean contract.
  reserveTask(key, operationKey) {
    return this.reserveDecision(key, operationKey);
  }

  async reserveDecision(key, operationKey) {
    if (!validKey(key) || (operationKey !== null && !validKey(operationKey)))
      throw new Error("Invalid inference reservation identity.");
    const now = this.now();
    const minute = Math.floor(now / 60000);
    const nextDay = Math.floor(now / 86400000) * 86400000 + 86400000;
    const daily = this.dailyLimits();
    const denied = (reason, retryAt) => ({ accepted: false, reason, retryAt });
    const accepted = { accepted: true };
    const decision = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      if (operationKey) {
        const prior = sql
          .exec(
            "SELECT client, state FROM reservations WHERE id = ?",
            operationKey,
          )
          .toArray()[0];
        if (prior) {
          if (prior.client !== key || prior.state === "released")
            return denied("reservation_closed", null);
          return accepted;
        }
        if (
          sql.exec("SELECT COUNT(*) AS count FROM reservations").one().count >=
          4096
        )
          return denied("model_allowance", nextDay);
      }
      const global = sql
        .exec("SELECT total FROM counts WHERE key = 'global'")
        .toArray()[0];
      const client = sql
        .exec("SELECT total, minute, burst FROM counts WHERE key = ?", key)
        .toArray()[0];
      const burst = client?.minute === minute ? client.burst : 0;
      if (
        (global?.total ?? 0) >= daily.global ||
        (client?.total ?? 0) >= daily.client
      )
        return denied("model_allowance", nextDay);
      if (burst >= 12) return denied("model_capacity", (minute + 1) * 60000);
      sql.exec(
        "INSERT OR REPLACE INTO counts (key, total, minute, burst) VALUES ('global', ?, ?, 0)",
        (global?.total ?? 0) + 1,
        minute,
      );
      sql.exec(
        "INSERT OR REPLACE INTO counts (key, total, minute, burst) VALUES (?, ?, ?, ?)",
        key,
        (client?.total ?? 0) + 1,
        minute,
        burst + 1,
      );
      if (operationKey)
        sql.exec(
          "INSERT INTO reservations (id, client, minute, state) VALUES (?, ?, ?, 'reserved')",
          operationKey,
          key,
          minute,
        );
      return accepted;
    });
    if (decision.accepted) await this.scheduleExpiry(now);
    return decision;
  }

  async settle(key, operationKey, consumed) {
    if (
      !validKey(key) ||
      !validKey(operationKey) ||
      typeof consumed !== "boolean"
    )
      return false;
    const result = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const reservation = sql
        .exec(
          "SELECT client, minute, state FROM reservations WHERE id = ?",
          operationKey,
        )
        .toArray()[0];
      // A cancelled reservation may reach this object before its delayed reserve call.
      if (!reservation) {
        if (consumed) return false;
        if (
          sql.exec("SELECT COUNT(*) AS count FROM reservations").one().count <
          4096
        )
          sql.exec(
            "INSERT INTO reservations (id, client, minute, state) VALUES (?, ?, 0, 'released')",
            operationKey,
            key,
          );
        return true;
      }
      if (reservation.client !== key) return false;
      const state = consumed ? "consumed" : "released";
      if (reservation.state !== "reserved") return reservation.state === state;
      sql.exec(
        "UPDATE reservations SET state = ? WHERE id = ?",
        state,
        operationKey,
      );
      if (!consumed) {
        sql.exec(
          "UPDATE counts SET total = MAX(0, total - 1) WHERE key = 'global'",
        );
        sql.exec(
          "UPDATE counts SET total = MAX(0, total - 1), burst = MAX(0, burst - CASE WHEN minute = ? THEN 1 ELSE 0 END) WHERE key = ?",
          reservation.minute,
          key,
        );
      }
      return true;
    });
    await this.scheduleExpiry(this.now());
    return result;
  }

  async scheduleExpiry(now) {
    if ((await this.ctx.storage.getAlarm()) === null) {
      const nextDay = Math.floor(now / 86400000) * 86400000 + 86400000;
      await this.ctx.storage.setAlarm(nextDay + 3600000);
    }
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
