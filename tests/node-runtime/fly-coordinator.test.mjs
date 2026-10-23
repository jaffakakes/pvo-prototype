import assert from "node:assert/strict";
import test from "node:test";
import {
  NODE_RUNTIME,
  NODE_LIMITS,
} from "../../server/cloud-services/node/runtime.js";
import { deferred, fixture, request } from "./coordinator.helpers.mjs";

const execution = "00000000-0000-4000-8000-000000000001";
const replacement = "00000000-0000-4000-8000-000000000002";
const absent = () => new Response(null, { status: 404 });

test("provider preparation beyond the old request limit retains its lease and completes with measured startup", async () => {
  const now = Date.UTC(2100, 0, 1, 12);
  let f,
    advanced = false;
  const provider = fly({
    inspect: async () => {
      if (!advanced) {
        advanced = true;
        await f.call({ kind: "time", now: now + 70000 });
      }
    },
  });
  f = await fixture(provider.request, { provider: true });
  try {
    await f.call({ kind: "time", now });
    const result = await f.call({
      ...request(execution),
      expiresAt: now + NODE_LIMITS.leaseMs,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const usage = await f.call({
      kind: "usage",
      ownerId: "creator",
      serviceId: "service-one",
    });
    assert.equal(usage.periods.test.startupMilliseconds, 70000);
    assert.equal(usage.pending, null);
    assert.deepEqual(usage.instance, {
      provider: "fly",
      region: "iad",
      cpuKind: "shared",
      cpus: 1,
      memoryMiB: 1024,
    });
  } finally {
    await f.close();
  }
});

function fly({
  loseCreate = false,
  loseDelete = false,
  inspect = () => {},
} = {}) {
  const calls = [];
  let machine = null,
    visible = !loseCreate;
  return {
    calls,
    reveal: () => {
      visible = true;
    },
    request: async (r) => {
      assert.equal(new URL(r.url).origin, "https://api.machines.dev");
      const path = new URL(r.url).pathname;
      const body = r.method === "POST" ? await r.json() : null;
      calls.push({ method: r.method, path, body });
      if (r.method === "POST" && path.endsWith("/machines")) {
        machine = {
          id: "1234567890abcd",
          name: body.name,
          config: body.config,
          image_ref: { digest: NODE_RUNTIME.imageDigest },
          state: "stopped",
        };
        return loseCreate
          ? new Response(null, { status: 503 })
          : Response.json(machine);
      }
      if (r.method === "GET") {
        const captured = structuredClone(machine);
        await inspect({ calls, path });
        if (path.endsWith("/machines"))
          return Response.json(visible && machine ? [machine] : []);
        return captured ? Response.json(captured) : absent();
      }
      if (r.method === "DELETE") {
        machine = null;
        return loseDelete
          ? new Response(null, { status: 503 })
          : Response.json({});
      }
      if (path.endsWith("/start")) {
        machine.state = "started";
        return Response.json({});
      }
      assert.ok(path.endsWith("/exec"));
      const value = body.cmd.endsWith("'--ready'")
        ? {
            nodeVersion: NODE_RUNTIME.nodeVersion,
            runnerDigest: NODE_RUNTIME.runnerDigest,
          }
        : { result: "accepted", state: {} };
      return Response.json({
        stdout: JSON.stringify({ status: 200, body: JSON.stringify(value) }),
      });
    },
  };
}

test("the real Fly slot returns checked replies only after destruction and starts fresh for another scope", async () => {
  const provider = fly();
  const f = await fixture(provider.request, { provider: true });
  try {
    for (const [id, mode] of [
      [execution, "live"],
      [replacement, "test"],
    ]) {
      const result = await f.call({ ...request(id), mode });
      assert.deepEqual(result, {
        ok: true,
        value: { result: "accepted", state: {} },
      });
      assert.equal((await f.call({ kind: "inspect" })).lease, null);
    }
    const usage = await f.call({
      kind: "usage",
      ownerId: "creator",
      serviceId: "service-one",
    });
    assert.equal(usage.periods.live.starts, 1);
    assert.equal(usage.periods.test.starts, 1);
    assert.equal(usage.pending, null);
    assert.equal(
      provider.calls.filter(
        (c) => c.method === "POST" && c.path.endsWith("/machines"),
      ).length,
      2,
    );
    assert.equal(provider.calls.filter((c) => c.method === "DELETE").length, 2);
  } finally {
    await f.close();
  }
});

test("the real durable slot retains an unknown Fly creation through restart until its exact Machine is found", async () => {
  const provider = fly({ loseCreate: true });
  const f = await fixture(provider.request, { provider: true });
  try {
    assert.equal(
      (await f.call(request(execution))).code,
      "cleanup_unconfirmed",
    );
    const uncertain = await f.call({ kind: "inspect" });
    assert.equal(uncertain.lease.provider.execution, execution);
    assert.equal(uncertain.lease.provider.machineId, null);
    assert.equal(uncertain.lease.provider.phase, "dispatching");
    assert.equal(uncertain.usage[0].starts, 1);
    assert.ok(!JSON.stringify(uncertain).includes("export function"));
    await f.restart();
    assert.equal((await f.call({ kind: "cleanup" })).lease.id, execution);
    assert.equal(
      (await f.call(request(replacement))).code,
      "execution_capacity",
    );
    provider.reveal();
    assert.equal((await f.call({ kind: "cleanup" })).lease, null);
    assert.equal((await f.call(request(execution))).code, "execution_closed");
    assert.equal(provider.calls.filter((c) => c.method === "POST").length, 1);
    assert.equal(provider.calls.filter((c) => c.method === "DELETE").length, 1);
  } finally {
    await f.close();
  }
});

test("a lost Fly deletion keeps its accounting pending until a restarted slot confirms absence", async () => {
  const provider = fly({ loseDelete: true });
  const f = await fixture(provider.request, { provider: true });
  try {
    assert.equal(
      (await f.call(request(execution))).code,
      "cleanup_unconfirmed",
    );
    const held = await f.call({ kind: "inspect" });
    assert.equal(held.lease.provider.phase, "destroying");
    assert.equal(held.usage[0].milliseconds, 0);
    await f.restart();
    const cleaned = await f.call({ kind: "cleanup" });
    assert.equal(cleaned.lease, null);
    assert.ok(cleaned.usage[0].milliseconds > 0);
    assert.equal(provider.calls.filter((c) => c.method === "DELETE").length, 1);
    assert.equal(
      provider.calls.filter((c) => c.body?.cmd?.endsWith("'--execute'")).length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("cancelling the durable lease while Fly inspection is pending cannot dispatch a late start", async () => {
  const entered = deferred(),
    release = deferred();
  let inspections = 0;
  const provider = fly({
    inspect: async () => {
      if (++inspections === 2) {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const f = await fixture(provider.request, { provider: true });
  try {
    const executing = f.call(request(execution));
    await entered.promise;
    assert.equal(
      (await f.call({ kind: "cancel", id: execution })).closed,
      true,
    );
    release.resolve();
    assert.equal((await executing).ok, false);
    assert.equal((await f.call({ kind: "inspect" })).lease, null);
    assert.equal(
      provider.calls.filter(
        (c) => c.path.endsWith("/start") || c.path.endsWith("/exec"),
      ).length,
      0,
    );
    assert.equal(provider.calls.filter((c) => c.method === "DELETE").length, 1);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("missing Fly configuration does not break private usage reads or reserve execution capacity", async () => {
  let calls = 0;
  const f = await fixture(
    () => {
      calls++;
      throw new Error("unexpected provider call");
    },
    { provider: true, configured: false },
  );
  try {
    assert.equal(
      (await f.call(request(execution))).code,
      "runtime_unavailable",
    );
    const state = await f.call({ kind: "inspect" });
    assert.equal(state.lease, null);
    assert.deepEqual(state.usage, []);
    assert.equal(
      (
        await f.call({
          kind: "usage",
          ownerId: "creator",
          serviceId: "service-one",
        })
      ).capacity.busy,
      false,
    );
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});
