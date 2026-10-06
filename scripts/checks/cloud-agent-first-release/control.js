import { DurableObject } from "cloudflare:workers";
import { ProofModelMeter } from "./meter.js";

/** One private test ledger across both creators; never part of the product deployment. */
export class AcceptanceControl extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.meter = new ProofModelMeter(ctx.storage);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS proof_http (id INTEGER PRIMARY KEY, calls INTEGER NOT NULL)",
    );
  }
  reserve(expiresAt) {
    return this.meter.reserve(
      Math.min(expiresAt, Number(this.env.PROOF_EXPIRES_AT)),
    );
  }
  settle(id, status, usage) {
    this.meter.settle(id, status, usage);
  }
  report() {
    return {
      models: this.meter.report(),
      calls:
        this.ctx.storage.sql
          .exec("SELECT calls FROM proof_http WHERE id=1")
          .toArray()[0]?.calls ?? 0,
    };
  }
  allow() {
    return this.ctx.storage.transactionSync(() => {
      const count = this.report().calls;
      if (Date.now() >= Number(this.env.PROOF_EXPIRES_AT) || count >= 2000)
        return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO proof_http (id,calls) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET calls=calls+1",
      );
      return true;
    });
  }
}
