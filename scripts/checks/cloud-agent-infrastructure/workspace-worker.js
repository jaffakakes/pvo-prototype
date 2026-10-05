import { DurableObject } from "cloudflare:workers";
import { authorize, digest, limits, mark } from "./proof-http.js";
import { executeBounded } from "./workspace-execution.js";
import { workspaceProgram } from "./workspace-program.js";

export class Workspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get("state");
      if (state?.active) {
        await ctx.container.destroy();
        state.runs[state.active] = { status: "interrupted" };
        state.active = null;
        await ctx.storage.put("state", state);
        await ctx.storage.deleteAlarm();
      }
    });
  }

  async status() {
    return {
      state: (await this.ctx.storage.get("state")) ?? null,
      running: this.ctx.container.running,
      container: await this.ctx.container.inspect(),
    };
  }

  async run(kind) {
    if (!["build", "failure", "timeout"].includes(kind))
      return Response.json({ error: "unknown_run" }, { status: 404 });
    const claimed = await this.ctx.storage.transaction(async (storage) => {
      const state = (await storage.get("state")) ?? {
        active: null,
        runs: {},
        deleted: false,
      };
      if (state.deleted || state.active || state.runs[kind]) return false;
      state.active = kind;
      state.runs[kind] = { status: "running", startedAt: Date.now() };
      await storage.put("state", state);
      await storage.setAlarm(Date.now() + limits.workspaceMs);
      return true;
    });
    if (!claimed)
      return Response.json(
        { error: "run_already_used_or_busy" },
        { status: 409 },
      );
    const container = this.ctx.container;
    const startedAt = Date.now();
    let receipt;
    try {
      container.start({
        image: "cloudflare/debian-trixie",
        instance: "lite",
        entrypoint: ["sleep", String(limits.workspaceMs / 1000)],
        enableInternet: false,
        labels: { proof: this.env.PROOF_ID },
      });
      await container.setInactivityTimeout(1000);
      const program =
        kind === "build"
          ? workspaceProgram(this.env.PROOF_ID)
          : kind === "failure"
            ? "process.exit(7)"
            : "setInterval(() => {}, 1000)";
      const result = await executeBounded(
        container,
        ["node", "--input-type=module", "-e", program],
        kind === "timeout" ? 1000 : limits.commandMs,
      );
      if (result.exitCode !== 0)
        receipt = { status: "failed", exitCode: result.exitCode };
      else {
        const artifact = JSON.parse(result.stdout);
        if (
          artifact.platform !== "linux" ||
          artifact.proofId !== this.env.PROOF_ID ||
          artifact.testsPassed !== true ||
          artifact.networkBlocked !== true ||
          artifact.sha256 !== (await digest(artifact.source))
        )
          throw new Error("invalid_artifact");
        // Durable Object storage is outside the container's ephemeral filesystem.
        const saved = await this.ctx.storage.transaction(async (storage) => {
          const state = await storage.get("state");
          if (
            state?.deleted ||
            state?.active !== kind ||
            Date.now() >= startedAt + limits.workspaceMs
          )
            return false;
          await storage.put("artifact", artifact);
          return true;
        });
        if (!saved) throw new Error("run_cancelled");
        receipt = { status: "completed", sha256: artifact.sha256 };
      }
    } catch (error) {
      receipt = {
        status: "failed",
        error:
          error.message === "command_timeout"
            ? "command_timeout"
            : "workspace_execution_failed",
      };
    } finally {
      await container.destroy();
      receipt.durationMs = Date.now() - startedAt;
      receipt.stopped =
        !container.running && (await container.inspect()) === null;
      await this.ctx.storage.transaction(async (storage) => {
        const state = await storage.get("state");
        if (state?.deleted || state?.active !== kind) {
          receipt = { status: "cancelled", stopped: receipt.stopped };
          return;
        }
        state.runs[kind] = receipt;
        state.active = null;
        await storage.put("state", state);
        await storage.deleteAlarm();
      });
    }
    return Response.json(receipt);
  }

  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.container.destroy();
      const state = await this.ctx.storage.get("state");
      if (state?.active) {
        state.runs[state.active] = {
          status: "failed",
          error: "workspace_deadline",
          stopped: true,
        };
        state.active = null;
        await this.ctx.storage.put("state", state);
      }
    });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "DELETE") {
      await this.ctx.storage.put("state", {
        active: null,
        runs: {},
        deleted: true,
      });
      await this.ctx.container.destroy();
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete("artifact");
      return Response.json({
        deleted: true,
        running: this.ctx.container.running,
        artifactPresent: !!(await this.ctx.storage.get("artifact")),
      });
    }
    if (request.method === "POST") return this.run(path.slice(1));
    if (request.method === "GET" && path === "/status")
      return Response.json(await this.status());
    if (request.method === "GET" && path === "/artifact") {
      const artifact = await this.ctx.storage.get("artifact");
      return Response.json(artifact ?? { error: "no_artifact" }, {
        status: artifact ? 200 : 404,
      });
    }
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const denied = authorize(request, env);
    if (denied) return mark(denied, env);
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return mark(Response.json({ ready: true }), env);
    const response = await env.WORKSPACE.getByName(env.PROOF_ID).fetch(request);
    return mark(response, env);
  },
};
