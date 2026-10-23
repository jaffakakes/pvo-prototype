import { DurableObject } from "cloudflare:workers";
import { ServiceNodeExecution } from "../../../server/cloud-services/node/coordinator.js";

/** Diagnostic-only global admission. Product goal/model limits are unchanged. */
export class ProductControl extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS proof_starts(id TEXT PRIMARY KEY,at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS proof_closed(id INTEGER PRIMARY KEY)",
    );
  }
  allow() {
    return (
      Date.now() < Number(this.env.PROOF_EXPIRES_AT) &&
      !this.ctx.storage.sql.exec("SELECT id FROM proof_closed").toArray().length
    );
  }
  reserve(id) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      if (
        !this.allow() ||
        sql.exec("SELECT COUNT(*) AS n FROM proof_starts").one().n >= 32 ||
        sql.exec("SELECT id FROM proof_starts WHERE id=?", id).toArray().length
      )
        return false;
      sql.exec("INSERT INTO proof_starts VALUES(?,?)", id, Date.now());
      return true;
    });
  }
  close() {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO proof_closed VALUES(1)");
    return this.snapshot();
  }
  snapshot() {
    return {
      open: this.allow(),
      starts: this.ctx.storage.sql
        .exec("SELECT * FROM proof_starts ORDER BY at")
        .toArray(),
    };
  }
}

/** Uses the actual Fly effect and durable cleanup; adds only private diagnostic admission/inspection. */
export class ProductNode extends ServiceNodeExecution {
  async run(request) {
    if (!(await this.env.PROOF_CONTROL.getByName("global").reserve(request.id)))
      throw Object.assign(new Error("Diagnostic admission closed"), {
        code: "execution_allowance",
      });
    return super.run(request);
  }
  async diagnostic() {
    return { lease: this.lease(), alarm: await this.ctx.storage.getAlarm() };
  }
  restart() {
    this.ctx.abort("Controlled Node coordinator restart");
  }
  async expireLease() {
    const lease = this.lease();
    if (lease) {
      this.save({
        ...lease,
        deadlineAt: this.now() - 1,
        nextAt: this.now() + 1,
      });
      await this.ctx.storage.setAlarm(this.now() + 1);
    }
    return { armed: Boolean(lease) };
  }
  async dispose() {
    const lease = this.lease();
    if (lease) await this.cancel(lease.id);
    return { lease: this.lease() };
  }
}
