import { DurableObject } from "cloudflare:workers";
import { authorize, digest, limits, mark, readBounded } from "./proof-http.js";

export class Release extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "DELETE") {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.put("deleted", true);
      return Response.json({
        deleted: true,
        sourcePresent: !!(await this.ctx.storage.get("release")),
      });
    }
    if (await this.ctx.storage.get("deleted"))
      return new Response("Deleted", { status: 410 });
    if (request.method === "PUT" && path === "/release")
      return this.install(request);
    if (request.method === "GET" && path === "/status") {
      const release = await this.ctx.storage.get("release");
      return Response.json({
        sha256: release?.sha256 ?? null,
        calls: (await this.ctx.storage.get("calls")) ?? 0,
      });
    }
    if (
      request.method !== "POST" ||
      !["/call", "/network", "/oversize", "/spin"].includes(path)
    )
      return new Response("Not found", { status: 404 });
    let input;
    try {
      input = await readBounded(request.body, limits.requestBytes);
    } catch {
      return Response.json({ error: "input_limit" }, { status: 413 });
    }
    const release = await this.ctx.storage.get("release");
    if (!release) return new Response("No release", { status: 409 });
    const admitted = await this.ctx.storage.transaction(async (storage) => {
      if (await storage.get("deleted")) return false;
      const calls = (await storage.get("calls")) ?? 0;
      if (calls >= limits.calls) return false;
      await storage.put("calls", calls + 1);
      return true;
    });
    if (!admitted)
      return Response.json({ error: "request_limit" }, { status: 429 });
    try {
      const worker = this.env.LOADER.get(
        `${this.env.PROOF_ID}:${release.sha256}`,
        () => ({
          compatibilityDate: "2026-10-03",
          mainModule: "service.js",
          modules: { "service.js": release.source },
          env: {},
          globalOutbound: null,
          limits: { cpuMs: limits.cpuMs, subRequests: 0 },
        }),
      );
      const result = await worker.getEntrypoint().fetch(
        new Request(`https://service.invalid${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: input,
        }),
      );
      let text;
      try {
        text = await readBounded(result.body, limits.responseBytes);
      } catch {
        return Response.json({ error: "output_limit" }, { status: 502 });
      }
      return new Response(text, {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return Response.json(
        {
          error: /CPU/i.test(error.message)
            ? "cpu_limit"
            : "service_execution_failed",
        },
        { status: 502 },
      );
    }
  }

  async install(request) {
    let release;
    try {
      release = JSON.parse(
        await readBounded(request.body, limits.artifactBytes),
      );
    } catch {
      return new Response("Invalid artifact", { status: 400 });
    }
    if (
      typeof release?.source !== "string" ||
      release.sha256 !== (await digest(release.source))
    )
      return new Response("Invalid digest", { status: 400 });
    const installed = await this.ctx.storage.transaction(async (storage) => {
      if (await storage.get("deleted")) return false;
      const prior = await storage.get("release");
      if (prior) return prior.sha256 === release.sha256;
      await storage.put("release", {
        source: release.source,
        sha256: release.sha256,
      });
      return true;
    });
    return Response.json(
      { installed, sha256: release.sha256 },
      { status: installed ? 200 : 409 },
    );
  }
}

export default {
  async fetch(request, env) {
    const denied = authorize(request, env);
    if (denied) return mark(denied, env);
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return mark(Response.json({ ready: true }), env);
    const response = await env.RELEASE.getByName(env.PROOF_ID).fetch(request);
    return mark(response, env);
  },
};
