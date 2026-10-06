import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import {
  prepareServicePublication,
  serviceDigest,
  serviceResourceId,
} from "../../server/cloud-services/releaseContract.js";
import { createTask } from "../../packages/pvo-assistant/tasks/index.js";
import { input } from "../assistant-tasks/fixtures.mjs";
const NOW = Date.UTC(2100, 0, 1);
const source = `export default { async fetch(request, env) {
  const input = await request.json();
  if (input.big) return new Response('x'.repeat(5000));
  let blocked = false; try { await fetch('https://example.com'); } catch { blocked = true; }
  return Response.json({ value: input.value * 2, blocked, env: Object.keys(env), authorization: request.headers.get('authorization') });
} };`;
const publication = () =>
  prepareServicePublication(
    createTask(input(), {
      id: "task",
      ownerId: "owner",
      now: NOW,
      inputDigest: "a".repeat(64),
    }),
    "publish-one",
    source,
  );
let modules;
async function fixture() {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { ServiceRelease } from './server/cloud-services/release.js';
    export class TestRelease extends ServiceRelease {
      now() { return this.clock ?? Date.UTC(2100, 0, 1); }
      async expire(now) { this.clock = now; await this.alarm(); }
      inspect() { const row=this.row(); return { sourcePresent: !!row?.source, probes: row?.probes ?? 0 }; }
    }
    export default { async fetch(request, env) {
      const { action, target, publication, identity, input, now } = await request.json();
      const stub = env.SERVICE_RELEASES.getByName(target ?? identity?.resourceId ?? publication?.identity.resourceId);
      try {
        if (action === 'publish') return Response.json(await stub.publish(publication));
        if (action === 'lookup') return Response.json(await stub.lookup(identity));
        if (action === 'cancel') return Response.json(await stub.cancel(identity));
        if (action === 'probe') return Response.json(await stub.probe(identity, input));
        if (action === 'expire') { await stub.expire(now); return Response.json({ ok: true }); }
        return Response.json(await stub.inspect());
      } catch { return Response.json({ error: 'provider operation rejected' }, { status: 409 }); }
    } };
  `,
    },
  });
  const persistence = await mkdtemp(join(tmpdir(), "restyle-service-release-"));
  const bundled = await modules;
  const options = convertV4MiniflareOptions({
    name: "release-test",
    modules: bundled,
    compatibilityDate: "2026-10-03",
    durableObjects: {
      SERVICE_RELEASES: { className: "TestRelease", useSQLite: true },
    },
    workerLoaders: { SERVICE_LOADER: {} },
    isolatedResourcePersistencePath: persistence,
    resourcePersistencePath: persistence,
  });
  let mf = new Miniflare(options);
  return {
    async call(action, values) {
      const response = await mf.dispatchFetch("https://release.test", {
        method: "POST",
        body: JSON.stringify({ action, ...values }),
      });
      return { status: response.status, body: await response.json() };
    },
    async restart() {
      await mf.dispose();
      mf = new Miniflare(options);
      await mf.ready;
    },
    async close() {
      try {
        await mf.dispose();
      } finally {
        await rm(persistence, { recursive: true, force: true });
      }
    },
  };
}

test("immutable inactive release survives a provider restart, stays isolated and has a bounded probe budget", async () => {
  const f = await fixture(),
    value = await publication();
  try {
    assert.equal(
      (await f.call("lookup", { identity: value.identity })).body.state,
      "missing",
    );
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.call("publish", { publication: value }),
      ),
    );
    for (const response of responses)
      assert.equal(response.body.state, "available");
    await f.restart();
    assert.equal(
      (await f.call("lookup", { identity: value.identity })).body.state,
      "available",
    );
    const result = await f.call("probe", {
      identity: value.identity,
      input: { value: 21 },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body.body), {
      value: 42,
      blocked: true,
      env: [],
      authorization: null,
    });
    const probes = await Promise.all(
      Array.from({ length: 25 }, () =>
        f.call("probe", { identity: value.identity, input: { value: 3 } }),
      ),
    );
    assert.equal(probes.filter((result) => result.status === 200).length, 19);
    assert.equal(
      (await f.call("inspect", { identity: value.identity })).body.probes,
      20,
    );
  } finally {
    await f.close();
  }
});

test("owned cancellation tombstones block delayed publication, including across restart", async () => {
  const f = await fixture(),
    value = await publication();
  try {
    assert.equal(
      (await f.call("cancel", { identity: value.identity })).body.state,
      "deleted",
    );
    await f.restart();
    assert.equal(
      (await f.call("publish", { publication: value })).body.state,
      "deleted",
    );
    assert.equal(
      (await f.call("probe", { identity: value.identity, input: {} })).status,
      409,
    );
    assert.equal(
      (await f.call("inspect", { identity: value.identity })).body
        .sourcePresent,
      false,
    );
  } finally {
    await f.close();
  }
});

test("ownership, contents, lifetimes and runtime limits remain checked at the provider", async () => {
  const f = await fixture(),
    value = await publication();
  try {
    assert.equal((await f.call("publish", { publication: value })).status, 200);
    const foreign = { ...value.identity, ownerId: "other" };
    foreign.resourceId = await serviceResourceId(foreign);
    for (const action of ["lookup", "cancel", "probe"])
      assert.equal(
        (
          await f.call(action, {
            target: value.identity.resourceId,
            identity: foreign,
            input: {},
          })
        ).status,
        409,
      );
    assert.equal(
      (
        await f.call("publish", {
          publication: { ...value, source: "different" },
        })
      ).status,
      409,
    );
    const changed = {
      identity: {
        ...value.identity,
        sourceDigest: await serviceDigest("different"),
      },
      source: "different",
    };
    assert.equal(
      (await f.call("publish", { publication: changed })).status,
      409,
    );
    assert.equal(
      (
        await f.call("probe", {
          identity: value.identity,
          input: { big: true },
        })
      ).status,
      409,
    );
    await f.call("expire", { identity: value.identity, now: NOW });
    assert.equal(
      (await f.call("lookup", { identity: value.identity })).body.state,
      "available",
      "An early wakeup cannot erase a release",
    );
    await f.call("expire", {
      identity: value.identity,
      now: value.identity.expiresAt,
    });
    assert.equal(
      (await f.call("lookup", { identity: value.identity })).body.state,
      "deleted",
    );
    assert.equal(
      (await f.call("inspect", { identity: value.identity })).body
        .sourcePresent,
      false,
    );
  } finally {
    await f.close();
  }
});
