import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { dinnerSource } from "../service-validation/fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import {
  prepareServicePublication,
  serviceResourceId,
} from "../../server/cloud-services/releaseContract.js";
import { createTask } from "../../packages/pvo-assistant/tasks/index.js";
import { input } from "../assistant-tasks/fixtures.mjs";
const NOW = Date.UTC(2100, 0, 1);
const source = `import {env} from 'cloudflare:workers';
${dinnerSource.replace("export function execute", "function rules")}
export async function execute(value) {
  if (Object.keys(env).length) throw new Error('Unexpected binding');
  let blocked=false; try { await fetch('https://example.com'); } catch {blocked=true;}
  if (!blocked) throw new Error('Unexpected network access');
  if (value.input?.name === 'overflow') return {result:'x'.repeat(70000),state:value.state};
  return rules(value);
}`;
const publication = async (operationId = "publish-one") =>
  prepareServicePublication(
    createTask(input(), {
      id: "task",
      ownerId: "owner",
      now: NOW,
      inputDigest: "a".repeat(64),
    }),
    operationId,
    await checkedFixture(source),
  );
let modules;
async function fixture() {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { HostedService } from './server/cloud-services/host.js';
    export class TestRelease extends HostedService {
      now() { return this.clock ?? Date.UTC(2100, 0, 1); }
      setClock(now) {this.clock=now;}
      async expire(now) { this.clock = now; await this.alarm(); }
      inspect(identity) { const row=this.store.row(identity.resourceId); return { sourcePresent: !!row?.body, probes: row?.probes ?? 0, testReleaseId:this.store.service()?.testReleaseId, records:this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM service_data").one().count, receipts:this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM service_actions").one().count }; }
    }
    export default { async fetch(request, env) {
      const { action, target, publication, identity, input, now } = await request.json();
      const stub = env.SERVICE_HOSTS.getByName(target ?? identity?.serviceId ?? publication?.identity.serviceId);
      try {
        if (action === 'clock') {await stub.setClock(now);return Response.json({ok:true});}
        if (action === 'act') return Response.json(await stub.invoke(identity.serviceId,{kind:'creator',ownerId:identity.ownerId,mode:'test'},input));
        if (action === 'publish') return Response.json(await stub.publish(publication));
        if (action === 'lookup') return Response.json(await stub.lookup(identity));
        if (action === 'cancel') return Response.json(await stub.cancel(identity));
        if (action === 'probe') return Response.json(await stub.probe(identity, input));
        if (action === 'expire') { await stub.expire(now); return Response.json({ ok: true }); }
        return Response.json(await stub.inspect(identity));
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
      SERVICE_HOSTS: { className: "TestRelease", useSQLite: true },
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
      input: { operation: "join", input: { name: "Alice" } },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body.body), {
      result: "accepted",
      state: { capacity: 1, guests: ["Alice"] },
    });
    const probes = await Promise.all(
      Array.from({ length: 25 }, () =>
        f.call("probe", {
          identity: value.identity,
          input: { operation: "join", input: { name: "Bob" } },
        }),
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
            target: value.identity.serviceId,
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
    const changed = structuredClone(value);
    changed.artifact.package.files[0].content += "\n// changed source";
    assert.equal(
      (await f.call("publish", { publication: changed })).status,
      409,
    );
    assert.equal(
      (
        await f.call("probe", {
          identity: value.identity,
          input: { operation: "join", input: { name: "overflow" } },
        })
      ).status,
      409,
    );
    for (const override of [
      { mode: "live" },
      { state: { capacity: 99, guests: [] } },
      { now: 1 },
    ])
      assert.equal(
        (
          await f.call("probe", {
            identity: value.identity,
            input: { operation: "join", input: { name: "Alice" }, ...override },
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

test("one stable service retains independent immutable releases and an old retry cannot replace its selected version", async () => {
  const f = await fixture();
  try {
    const first = await publication("one"),
      second = await publication("two");
    assert.equal(first.identity.serviceId, second.identity.serviceId);
    assert.notEqual(first.identity.resourceId, second.identity.resourceId);
    assert.equal(
      (await f.call("publish", { publication: first })).body.state,
      "available",
    );
    assert.equal(
      (await f.call("publish", { publication: second })).body.state,
      "available",
    );
    assert.equal(
      (await f.call("publish", { publication: first })).body.state,
      "available",
    );
    assert.equal(
      (await f.call("inspect", { identity: second.identity })).body
        .testReleaseId,
      second.identity.resourceId,
    );
    await f.call("cancel", { identity: first.identity });
    await f.restart();
    assert.equal(
      (await f.call("publish", { publication: first })).body.state,
      "deleted",
    );
    assert.equal(
      (await f.call("lookup", { identity: second.identity })).body.state,
      "available",
    );
    const reply = await f.call("probe", {
      identity: second.identity,
      input: { operation: "join", input: { name: "Alice" } },
    });
    assert.equal(reply.status, 200);
    assert.equal(JSON.parse(reply.body.body).result, "accepted");
    for (const id of ["three", "four"])
      assert.equal(
        (await f.call("publish", { publication: await publication(id) }))
          .status,
        200,
      );
    assert.equal(
      (await f.call("publish", { publication: await publication("five") }))
        .status,
      409,
    );
    assert.equal(
      (await f.call("lookup", { identity: second.identity })).body.state,
      "available",
    );
  } finally {
    await f.close();
  }
});

test("a delayed repeat publication after expiry removes test records even when it clears the last alarm", async () => {
  const f = await fixture(),
    value = await publication();
  try {
    await f.call("publish", { publication: value });
    const result = await f.call("act", {
      identity: value.identity,
      input: { actionId: "saved", operation: "join", input: { name: "Alice" } },
    });
    assert.equal(result.body.ok, true);
    assert.equal(
      (await f.call("inspect", { identity: value.identity })).body.receipts,
      1,
    );
    await f.call("clock", {
      identity: value.identity,
      now: value.identity.expiresAt + 1,
    });
    assert.equal(
      (await f.call("publish", { publication: value })).body.state,
      "deleted",
    );
    const status = (await f.call("inspect", { identity: value.identity })).body;
    assert.equal(status.sourcePresent, false);
    assert.equal(status.records, 0);
    assert.equal(status.receipts, 0);
    await f.restart();
    assert.equal(
      (await f.call("publish", { publication: value })).body.state,
      "deleted",
    );
  } finally {
    await f.close();
  }
});
