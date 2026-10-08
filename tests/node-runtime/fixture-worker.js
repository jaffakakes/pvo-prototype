import { DurableObject } from "cloudflare:workers";
import { NodeMetering } from "../../server/cloud-services/node/metering.js";

/** Local integration fixture only. Provider isolation is covered by the recorded Fly proof. */
export class FixtureNodeExecution extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.metering = new NodeMetering(ctx.storage.sql);
  }
  async execute(request) {
    const startedAt = Date.now();
    const lease = {
      ...request,
      day: Math.floor(startedAt / 86400000),
      startedAt,
      readyAt: startedAt,
      finishedAt: startedAt,
      resultBytes: 0,
    };
    this.metering.reserve(
      lease,
      new TextEncoder().encode(JSON.stringify(request.bundle)).length,
    );
    try {
      const response = await this.env.NODE_FIXTURE.fetch(
        "https://node-fixture.test",
        {
          method: "POST",
          body: JSON.stringify(request),
        },
      );
      const result = await response.json();
      lease.resultBytes = new TextEncoder().encode(
        JSON.stringify(result),
      ).length;
      return result;
    } finally {
      lease.finishedAt = Date.now();
      this.metering.settle(lease, lease.finishedAt);
    }
  }
  usage(ownerId, serviceId) {
    return this.metering.snapshot(
      ownerId,
      serviceId,
      { platform: 500, owner: 50 },
      null,
      Date.now(),
    );
  }
  cancel() {
    return { ok: true };
  }
}
