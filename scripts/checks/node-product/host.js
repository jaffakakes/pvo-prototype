import { HostedService } from "../../../server/cloud-services/host.js";
import { inspectHostedService } from "../../../server/cloud-services/control.js";

export class ProductHost extends HostedService {
  constructor(ctx, env) {
    super(ctx, env);
    this.instanceId = crypto.randomUUID();
  }
  now() {
    return this.proofNow ?? Date.now();
  }
  restart() {
    this.ctx.abort("Controlled hosted service restart");
  }
  async diagnostic() {
    let inspection;
    try {
      const identity = this.store.service().identity;
      inspection = inspectHostedService(
        this,
        identity.serviceId,
        identity.ownerId,
      );
    } catch (error) {
      inspection = { error: error.message };
    }
    return {
      inspection,
      instanceId: this.instanceId,
      service: this.store.service(),
      releases: this.store.rows().map((row) => ({
        id: row.id,
        retained: row.retained,
        present: row.body !== null,
        expiresAt: JSON.parse(row.identity).expiresAt,
      })),
      draft: this.drafts.read(),
      alarm: await this.ctx.storage.getAlarm(),
    };
  }
  async sweep(at) {
    if (
      !Number.isSafeInteger(at) ||
      at < Date.now() ||
      at > Date.now() + 32 * 86400000
    )
      throw new Error("Invalid diagnostic retention time");
    this.proofNow = at;
    try {
      await super.alarm();
      return await this.diagnostic();
    } finally {
      this.proofNow = null;
    }
  }
}
