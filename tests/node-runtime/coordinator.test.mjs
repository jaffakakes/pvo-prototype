import test from "node:test";
import assert from "node:assert/strict";
import { estimateNodeCompute } from "../../server/cloud-services/node/cost.js";
import { deferred, fixture, request } from "./coordinator.helpers.mjs";

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

test("idle maintenance expires only elapsed replay fences and schedules usage retention without new calls", async () => {
  const f = await fixture();
  try {
    const now = Date.UTC(2100, 0, 1, 12);
    await f.call({ kind: "time", now });
    assert.equal(
      (await f.call({ ...request("retained"), expiresAt: now + 10000 })).ok,
      true,
    );
    const original = await f.call({ kind: "inspect" });
    assert.equal(original.receipts.length, 1);
    assert.equal(original.alarm, now + 45000);
    await f.restart();
    await f.call({ kind: "time", now: original.alarm - 1 });
    const early = await f.call({ kind: "cleanup" });
    assert.equal(early.receipts.length, 1);
    assert.equal(early.usage[0].starts, 1);
    await f.call({ kind: "time", now: original.alarm });
    const expired = await f.call({ kind: "cleanup" });
    assert.deepEqual(expired.receipts, []);
    assert.equal(expired.usage[0].starts, 1);
    assert.equal(expired.alarm, Date.UTC(2100, 1, 1));
    await f.restart();
    await f.call({ kind: "time", now: expired.alarm });
    const cleaned = await f.call({ kind: "cleanup" });
    assert.deepEqual(cleaned.usage, []);
    assert.equal(cleaned.alarm, null);
  } finally {
    await f.close();
  }
});

test("an old unresolved destruction keeps its lease and metering row through admission and restarted cleanup", async () => {
  let fail = true,
    starts = 0;
  const f = await fixture(async (r) => {
    const { kind } = await r.json();
    if (kind === "start") starts++;
    return Response.json({ fail: kind === "destroy" && fail });
  });
  try {
    const now = Date.UTC(2100, 0, 1, 12);
    await f.call({ kind: "time", now });
    assert.equal(
      (await f.call({ ...request("uncertain"), expiresAt: now + 10000 })).code,
      "cleanup_unconfirmed",
    );
    await f.restart();
    const later = now + 32 * 86400000;
    await f.call({ kind: "time", now: later });
    assert.equal(
      (await f.call({ ...request("waiting"), expiresAt: later + 10000 })).code,
      "execution_capacity",
    );
    const stillOwned = await f.call({ kind: "cleanup" });
    assert.equal(stillOwned.lease.id, "uncertain");
    assert.equal(stillOwned.usage[0].starts, 1);
    assert(stillOwned.alarm > later);
    assert.equal(starts, 1);
    fail = false;
    const cleaned = await f.call({ kind: "cleanup" });
    assert.equal(cleaned.lease, null);
    assert.deepEqual(cleaned.usage, []);
    assert.equal(
      cleaned.receipts.length,
      1,
      "late dispatch remains fenced after confirmed cleanup",
    );
  } finally {
    await f.close();
  }
});

test("read-only metering separates owners, services and phases and never hides pending cleanup in completed costs", async () => {
  const entered = deferred(),
    release = deferred();
  let starts = 0,
    hold = false;
  const f = await fixture(async (r) => {
    const { kind } = await r.json();
    if (kind === "start") starts++;
    if (kind === "execute" && hold) {
      entered.resolve();
      await release.promise;
    }
    return Response.json({
      result: "private result must not appear in usage",
      state: {},
    });
  });
  try {
    const now = Date.UTC(2100, 0, 1, 12);
    await f.call({ kind: "time", now });
    const scope = {
      kind: "usage",
      ownerId: "creator",
      serviceId: "service-one",
    };
    const empty = await f.call(scope);
    assert.equal(empty.capacity.ownerRemaining, 2);
    assert.equal(empty.capacity.busy, false);
    assert.equal(starts, 0, "inspection starts no compute");
    hold = true;
    const running = f.call({
      ...request("measured"),
      mode: "validation",
      expiresAt: now + 10000,
    });
    await entered.promise;
    await f.call({ kind: "time", now: now + 1200 });
    const pending = await f.call(scope);
    assert.equal(pending.capacity.ownerRemaining, 1);
    assert.equal(pending.periods.validation.starts, 1);
    assert.equal(pending.periods.validation.milliseconds, 0);
    assert.equal(pending.pending.milliseconds, 1200);
    const other = await f.call({ ...scope, ownerId: "other" });
    assert.equal(other.capacity.busy, true);
    assert.equal(other.pending, null);
    assert.equal(other.periods.validation.starts, 0);
    assert.equal(other.capacity.ownerRemaining, 2);
    assert.equal(
      (await f.call({ ...scope, serviceId: "different" })).pending,
      null,
    );
    const expected = estimateNodeCompute(pending);
    assert.equal(expected.completed.validation.withFullCpuUsd, 0);
    assert(Math.abs(expected.pending.withFullCpuUsd - 0.000002418) < 1e-12);
    assert.equal(expected.allowancesApplied, false);
    release.resolve();
    assert.equal((await running).ok, true);
    const done = await f.call(scope);
    assert.equal(done.pending, null);
    const total = done.periods.validation;
    assert.equal(total.milliseconds, 1200);
    assert.equal(
      total.startupMilliseconds +
        total.executionMilliseconds +
        total.cleanupMilliseconds,
      total.milliseconds,
    );
    assert.equal(total.executionMilliseconds, 1200);
    assert(total.admittedBytes > 0);
    assert(total.resultBytes > 0);
    assert.equal(done.periods.live.starts, 0);
    assert(!JSON.stringify(done).includes("private result"));
    await f.restart();
    await f.call({ kind: "time", now: now + 1200 });
    assert.deepEqual(await f.call(scope), done);
    assert.equal(starts, 1);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("metering records startup and uncertain shutdown outside the guest and settles each phase once", async () => {
  const starting = deferred(),
    ready = deferred(),
    executing = deferred(),
    done = deferred();
  let failCleanup = true;
  const f = await fixture(async (r) => {
    const { kind } = await r.json();
    if (kind === "start") {
      starting.resolve();
      await ready.promise;
    }
    if (kind === "execute") {
      executing.resolve();
      await done.promise;
    }
    return Response.json({ fail: kind === "destroy" && failCleanup });
  });
  try {
    const now = Date.UTC(2100, 0, 1, 12);
    await f.call({ kind: "time", now });
    const scope = {
      kind: "usage",
      ownerId: "creator",
      serviceId: "service-one",
    };
    const running = f.call({
      ...request("timed"),
      mode: "live",
      expiresAt: now + 10000,
    });
    await starting.promise;
    await f.call({ kind: "time", now: now + 500 });
    ready.resolve();
    await executing.promise;
    await f.call({ kind: "time", now: now + 700 });
    done.resolve();
    assert.equal((await running).code, "cleanup_unconfirmed");
    await f.restart();
    await f.call({ kind: "time", now: now + 2700 });
    const uncertain = await f.call(scope);
    assert.equal(uncertain.pending.phase, "cleanup");
    assert.equal(uncertain.pending.milliseconds, 2700);
    assert.equal(uncertain.periods.live.milliseconds, 0);
    assert.equal(uncertain.periods.live.starts, 1);
    failCleanup = false;
    await f.call({ kind: "cleanup" });
    const measured = await f.call(scope);
    assert.equal(measured.pending, null);
    const usage = measured.periods.live;
    assert.equal(usage.milliseconds, 2700);
    assert.equal(usage.startupMilliseconds, 500);
    assert.equal(usage.executionMilliseconds, 200);
    assert.equal(usage.cleanupMilliseconds, 2000);
    await f.call({ kind: "cleanup" });
    assert.deepEqual((await f.call(scope)).periods, measured.periods);
  } finally {
    ready.resolve();
    done.resolve();
    await f.close();
  }
});
