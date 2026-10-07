import { ServiceNodeExecution } from "../../../server/cloud-services/node/coordinator.js";
import { estimateNodeCompute } from "../../../server/cloud-services/node/cost.js";
import {
  NODE_LIMITS,
  NODE_RUNTIME,
} from "../../../server/cloud-services/node/runtime.js";
import {
  authorize,
  mark,
  readBounded,
} from "../cloud-agent-infrastructure/proof-http.js";

/** Diagnostic policy only; all execution/cleanup behavior is the product adapter. */
export class ProofExecution extends ServiceNodeExecution {
  limits() {
    const prior = this.ctx.storage.sql
      .exec(
        "SELECT COALESCE(SUM(starts),0) AS count FROM node_usage WHERE day<>?",
        Math.floor(this.now() / 86400000),
      )
      .one().count;
    return {
      owner: Math.max(0, 50 - prior),
      platform: Math.max(0, 50 - prior),
    };
  }
  async run(request) {
    if (
      this.now() >= Number(this.env.PROOF_EXPIRES_AT) ||
      (await this.ctx.storage.get("revoked"))
    )
      throw Object.assign(new Error("Proof closed"), {
        code: "execution_closed",
      });
    return super.run(request);
  }
  async diagnostic() {
    const metering = this.usage("proof-owner", "proof-service");
    return {
      lease: this.lease(),
      running: this.ctx.container.running,
      instance: await this.ctx.container.inspect(),
      runtime: NODE_RUNTIME,
      usage: this.ctx.storage.sql.exec("SELECT * FROM node_usage").toArray(),
      metering,
      estimate: estimateNodeCompute(metering),
    };
  }
  async dispose() {
    await this.ctx.storage.put("revoked", true);
    const lease = this.lease();
    if (lease) await this.cancel(lease.id);
    else await this.native.destroy();
    return this.diagnostic();
  }
}

export default {
  async fetch(request, env) {
    const denied = authorize(request, env);
    if (denied) return mark(denied, env);
    const url = new URL(request.url),
      slot = Number(url.searchParams.get("slot") ?? 0);
    if (![0, 1].includes(slot))
      return mark(new Response("Invalid slot", { status: 400 }), env);
    const stub = env.NODE_EXECUTION.getByName(`slot-${slot}`);
    let reply;
    if (request.method === "DELETE")
      reply = {
        slots: await Promise.all(
          [0, 1].map((i) =>
            env.NODE_EXECUTION.getByName(`slot-${i}`).dispose(),
          ),
        ),
      };
    else if (request.method === "GET" && url.pathname === "/health")
      reply = { ready: true, runtime: NODE_RUNTIME };
    else if (request.method === "GET" && url.pathname === "/status")
      reply = await stub.diagnostic();
    else if (request.method === "POST" && url.pathname === "/execute") {
      let input;
      try {
        input = JSON.parse(
          await readBounded(request.body, NODE_LIMITS.requestBytes),
        );
      } catch {
        return mark(new Response("Invalid request", { status: 400 }), env);
      }
      reply = await stub.execute(input);
    } else if (request.method === "POST" && url.pathname === "/cancel") {
      const { id } = JSON.parse(await readBounded(request.body, 256));
      reply = await stub.cancel(id);
    } else return mark(new Response("Not found", { status: 404 }), env);
    return mark(Response.json(reply), env);
  },
};
