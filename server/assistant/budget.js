import { DurableObject } from "cloudflare:workers";

// One object coordinates a single UTC day's bounded beta inference allowance.
// No prompts, project data, provider payloads, or raw addresses are stored here.
export class AssistantBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counts (key TEXT PRIMARY KEY, total INTEGER NOT NULL, minute INTEGER NOT NULL, burst INTEGER NOT NULL)");
  }

  async reserve(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) return false;
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const accepted = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const global = sql.exec("SELECT total FROM counts WHERE key = 'global'").toArray()[0];
      const client = sql.exec("SELECT total, minute, burst FROM counts WHERE key = ?", key).toArray()[0];
      const burst = client?.minute === minute ? client.burst : 0;
      // One supported task can make six model turns plus six metered observations.
      // Let that task finish within a minute without increasing either daily cap.
      if ((global?.total ?? 0) >= 60 || (client?.total ?? 0) >= 20 || burst >= 12) return false;
      sql.exec("INSERT OR REPLACE INTO counts (key, total, minute, burst) VALUES ('global', ?, ?, 0)", (global?.total ?? 0) + 1, minute);
      sql.exec("INSERT OR REPLACE INTO counts (key, total, minute, burst) VALUES (?, ?, ?, ?)", key, (client?.total ?? 0) + 1, minute, burst + 1);
      return true;
    });
    if (accepted && await this.ctx.storage.getAlarm() === null) {
      const nextDay = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
      await this.ctx.storage.setAlarm(nextDay + 3_600_000);
    }
    return accepted;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
