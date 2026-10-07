import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
let modules;
async function fixture(effect = async () => Response.json({})) {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { ServiceNodeExecution } from './server/cloud-services/node/coordinator.js';
    export class TestExecution extends ServiceNodeExecution {
      containerAdapter(){const effect=async kind=>{const reply=await (await this.env.EFFECTS.fetch('https://effect.test',{method:'POST',body:JSON.stringify({kind})})).json();if(reply.fail)throw new Error('Controlled missing receipt');return reply;};return {
        start:()=>{this.started=effect('start');}, ready:async check=>{await this.started;check();},
        execute:()=>effect('execute'),destroy:()=>effect('destroy'),
      };}
      limits(){return {owner:2,platform:4};}
      sweep(){return this.alarm();}
      diagnostic(){return {lease:this.lease(),usage:this.ctx.storage.sql.exec('SELECT * FROM node_usage').toArray()};}
    }
    export default {async fetch(request,env){const {kind,...input}=await request.json();const stub=env.RUNTIME.getByName('slot-0');
      if(kind==='execute')return Response.json(await stub.execute(input));
      if(kind==='cancel')return Response.json(await stub.cancel(input.id));
      if(kind==='cleanup'){await stub.sweep();return Response.json(await stub.diagnostic());}
      return Response.json(await stub.diagnostic());
    }};`,
    },
  });
  const root = await mkdtemp(join(tmpdir(), "restyle-node-state-"));
  let mf;
  const start = async () => {
    mf = new Miniflare(
      await convertV4MiniflareOptions({
        modules: await modules,
        compatibilityDate: "2026-10-03",
        durableObjects: {
          RUNTIME: { className: "TestExecution", useSQLite: true },
        },
        serviceBindings: { EFFECTS: effect },
        isolatedResourcePersistencePath: root,
        resourcePersistencePath: root,
      }),
    );
  };
  await start();
  return {
    call: async (body) =>
      (
        await mf.dispatchFetch("https://test/", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json(),
    restart: async () => {
      await mf.dispose();
      await start();
    },
    close: async () => {
      await mf.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const request = (id, ownerId = "creator") => ({
  kind: "execute",
  id,
  ownerId,
  serviceId: "service-one",
  mode: "test",
  expiresAt: Date.now() + 10000,
  bundle: {
    entrypoint: "src/main.mjs",
    files: [
      {
        path: "src/main.mjs",
        content: "export function execute(){return null}",
      },
    ],
    dependencies: [],
  },
  invocation: {},
});

test("a durable Node slot meters owned calls, fences replay and preserves daily capacity through restart", async () => {
  const calls = [];
  const f = await fixture(async (request) => {
    const { kind } = await request.json();
    calls.push(kind);
    return Response.json({ result: "ok", state: {} });
  });
  try {
    const input = request("first");
    assert.equal((await f.call(input)).ok, true);
    assert.equal((await f.call(input)).code, "execution_closed");
    await f.restart();
    assert.equal((await f.call(request("second"))).ok, true);
    assert.equal((await f.call(request("third"))).code, "execution_allowance");
    const diagnostic = await f.call({ kind: "inspect" });
    assert.equal(diagnostic.lease, null);
    assert.equal(diagnostic.usage[0].starts, 2);
    assert.equal(diagnostic.usage[0].service_id, "service-one");
    assert.deepEqual(calls, [
      "start",
      "execute",
      "destroy",
      "start",
      "execute",
      "destroy",
    ]);
  } finally {
    await f.close();
  }
});

test("unknown destruction keeps capacity reserved until durable cleanup confirms absence", async () => {
  let fail = true,
    starts = 0;
  const f = await fixture(async (request) => {
    const { kind } = await request.json();
    if (kind === "start") starts++;
    return Response.json(
      kind === "destroy" && fail ? { fail: true } : { result: "ok", state: {} },
    );
  });
  try {
    assert.equal((await f.call(request("first"))).code, "cleanup_unconfirmed");
    assert.equal((await f.call(request("second"))).code, "execution_capacity");
    assert.equal(starts, 1);
    await f.restart();
    fail = false;
    assert.equal((await f.call({ kind: "cleanup" })).lease, null);
    assert.equal((await f.call(request("second"))).ok, true);
    assert.equal(starts, 2);
  } finally {
    await f.close();
  }
});

test("cancellation before dispatch and during execution cannot resurrect a guest or accept a late reply", async () => {
  const entered = deferred(),
    release = deferred();
  let starts = 0,
    destroys = 0;
  const f = await fixture(async (request) => {
    const { kind } = await request.json();
    if (kind === "start") starts++;
    if (kind === "destroy") destroys++;
    if (kind === "execute") {
      entered.resolve();
      await release.promise;
    }
    return Response.json({ result: "late", state: {} });
  });
  try {
    assert.equal(
      (await f.call({ kind: "cancel", id: "cancelled-first" })).closed,
      true,
    );
    assert.equal(
      (await f.call(request("cancelled-first"))).code,
      "execution_closed",
    );
    assert.equal(starts, 0);
    const running = f.call(request("running"));
    await entered.promise;
    assert.equal(
      (await f.call({ kind: "cancel", id: "running" })).closed,
      true,
    );
    release.resolve();
    assert.equal((await running).ok, false);
    assert.equal(starts, 1);
    assert.equal(destroys, 1);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("invalid source, unapproved dependencies and oversized invocation reserve no paid capacity", async () => {
  let starts = 0;
  const f = await fixture(async (r) => {
    if ((await r.json()).kind === "start") starts++;
    return Response.json({});
  });
  try {
    for (const mutate of [
      (r) => (r.bundle.files = []),
      (r) => (r.bundle.dependencies = [{ name: "unknown" }]),
      (r) => (r.invocation = { huge: "x".repeat(70000) }),
    ]) {
      const input = request("invalid");
      mutate(input);
      assert.equal((await f.call(input)).ok, false);
    }
    assert.equal(starts, 0);
    assert.deepEqual((await f.call({ kind: "inspect" })).usage, []);
  } finally {
    await f.close();
  }
});

test("overlapping cancellation cannot start a second destroy or free a still-cleaning slot", async () => {
  const entered = deferred(),
    release = deferred();
  let destroys = 0;
  const f = await fixture(async (r) => {
    const { kind } = await r.json();
    if (kind === "destroy") {
      destroys++;
      entered.resolve();
      await release.promise;
    }
    return Response.json({ result: "ok", state: {} });
  });
  try {
    const executing = f.call(request("running"));
    await entered.promise;
    const stopped = await f.call({ kind: "cancel", id: "running" });
    assert.equal(stopped.closed, false);
    assert.equal(
      (await f.call(request("replacement"))).code,
      "execution_capacity",
    );
    release.resolve();
    assert.equal((await executing).ok, false);
    assert.equal(destroys, 1);
    assert.equal((await f.call({ kind: "inspect" })).lease, null);
    const replacement = await f.call(request("replacement"));
    assert.equal(replacement.ok, true, JSON.stringify(replacement));
  } finally {
    release.resolve();
    await f.close();
  }
});

test("a maintenance alarm during confirmed execution cleanup preserves the successful result and owns only one destroy", async () => {
  const entered = deferred(),
    release = deferred();
  let destroys = 0;
  const f = await fixture(async (request) => {
    if ((await request.json()).kind === "destroy") {
      destroys++;
      entered.resolve();
      await release.promise;
    }
    return Response.json({ result: "ok", state: {} });
  });
  try {
    const executing = f.call(request("completed"));
    await entered.promise;
    const sweeping = await f.call({ kind: "cleanup" });
    assert.equal(sweeping.lease.phase, "cleanup");
    assert.equal((await f.call(request("waiting"))).code, "execution_capacity");
    release.resolve();
    const result = await executing;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(destroys, 1);
    assert.equal((await f.call({ kind: "inspect" })).lease, null);
  } finally {
    release.resolve();
    await f.close();
  }
});
