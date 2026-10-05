import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";
import {
  authorize,
  digest,
  readBounded,
} from "../scripts/checks/cloud-agent-infrastructure/proof-http.js";
import { executeBounded } from "../scripts/checks/cloud-agent-infrastructure/workspace-execution.js";

test("proof transport counts bytes, cancels excess output, and permits authenticated cleanup after expiry", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("éé"));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readBounded(stream, 3), /byte_limit/);
  assert.equal(cancelled, true);
  assert.equal(await readBounded(new Response("éé").body, 4), "éé");
  const env = {
    PROOF_ID: "test",
    PROOF_TOKEN: "secret",
    PROOF_EXPIRES_AT: "1",
  };
  const request = (method) =>
    new Request("https://proof.invalid", {
      method,
      headers: { Authorization: "Bearer secret" },
    });
  assert.equal(authorize(request("GET"), env).status, 410);
  assert.equal(authorize(request("DELETE"), env), null);
  assert.equal(
    authorize(new Request("https://proof.invalid", { method: "DELETE" }), env)
      .status,
    401,
  );
});

test("workspace deadline destroys the whole VM and successful execution releases its timer", async () => {
  let destroyed = 0;
  const hanging = {
    exec: () => new Promise(() => {}),
    async destroy() {
      destroyed++;
    },
  };
  await assert.rejects(
    executeBounded(hanging, ["node"], 10),
    /command_timeout/,
  );
  assert.equal(destroyed, 1);
  const success = {
    async exec() {
      return {
        stdout: new Response("done").body,
        stderr: new Response("").body,
        exitCode: Promise.resolve(0),
      };
    },
    async destroy() {
      destroyed++;
    },
  };
  assert.deepEqual(await executeBounded(success, ["node"], 10), {
    stdout: "done",
    stderr: "",
    exitCode: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(destroyed, 1);
});

test("hosted source survives worker restart, receives no secrets, and enforces concurrent quota and deletion", async () => {
  const modules = await bundleWorkerModules({
    entryPoints: [
      "scripts/checks/cloud-agent-infrastructure/service-worker.js",
    ],
  });
  const persist = await mkdtemp(join(tmpdir(), "restyle-runtime-test-"));
  const options = () =>
    convertV4MiniflareOptions({
      name: "restyle-service-test",
      modules,
      compatibilityDate: "2026-10-03",
      isolatedResourcePersistencePath: persist,
      resourcePersistencePath: persist,
      durableObjects: { RELEASE: { className: "Release", useSQLite: true } },
      workerLoaders: { LOADER: {} },
      bindings: {
        PROOF_ID: "test",
        PROOF_TOKEN: "secret",
        PROOF_EXPIRES_AT: String(Date.now() + 60_000),
      },
    });
  let mf = new Miniflare(options());
  const call = (path, method = "GET", body) =>
    mf.dispatchFetch(`https://proof.invalid${path}`, {
      method,
      headers: { Authorization: "Bearer secret" },
      ...(body === undefined ? {} : { body }),
    });
  const source = `export default { async fetch(request, env) {
    let blocked = false; try { await fetch("https://example.com"); } catch { blocked = true; }
    return Response.json({ blocked, authorization: request.headers.get("authorization"), keys: Object.keys(env) });
  } };`;
  const artifact = JSON.stringify({ source, sha256: await digest(source) });
  try {
    assert.equal(
      (await mf.dispatchFetch("https://proof.invalid/status")).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/release",
          "PUT",
          JSON.stringify({ source, sha256: "invalid" }),
        )
      ).status,
      400,
    );
    assert.equal((await call("/release", "PUT", artifact)).status, 200);
    assert.equal((await call("/release", "PUT", artifact)).status, 200);
    const different = `${source}\n`;
    assert.equal(
      (
        await call(
          "/release",
          "PUT",
          JSON.stringify({
            source: different,
            sha256: await digest(different),
          }),
        )
      ).status,
      409,
    );
    assert.equal((await call("/call", "POST", "x".repeat(4097))).status, 413);
    assert.deepEqual(await (await call("/call", "POST", "{}")).json(), {
      blocked: true,
      authorization: null,
      keys: [],
    });
    // Resetting workerd evicts the dynamic isolate while Durable Object storage remains.
    await mf.dispose();
    mf = new Miniflare(options());
    const results = await Promise.all(
      Array.from({ length: 24 }, () => call("/call", "POST", "{}")),
    );
    assert.equal(results.filter((result) => result.status === 200).length, 19);
    assert.equal(results.filter((result) => result.status === 429).length, 5);
    assert.equal((await (await call("/status")).json()).calls, 20);
    assert.deepEqual(await (await call("/", "DELETE")).json(), {
      deleted: true,
      sourcePresent: false,
    });
    assert.equal((await call("/call", "POST", "{}")).status, 410);
    assert.equal((await call("/release", "PUT", artifact)).status, 410);
  } finally {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});
