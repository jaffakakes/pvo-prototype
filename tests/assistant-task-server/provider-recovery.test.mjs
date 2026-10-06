import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, path, NOW, expectStatus } from "./helpers.mjs";
import {
  source,
  guard,
  publishing,
  publish,
  current,
  stats,
  deferred,
} from "./provider.helpers.mjs";

const rows = async (fixture) =>
  (await fixture.control({ action: "provider-rows" })).body;
const reconcile = async (fixture) => {
  const response = await fixture.control({ action: "provider-reconcile" });
  expectStatus(response, 200);
  return response.body[0];
};

test("destroying the runtime after provider creation recovers one owned release and one usage charge", async () => {
  const entered = deferred(),
    release = deferred();
  const fixture = await taskFixture({
    services: true,
    providerControl: async (request) => {
      const { phase, action } = await request.json();
      if (phase === "after" && action === "publish") {
        entered.resolve();
        await release.promise;
      }
      return Response.json({ fail: false });
    },
  });
  try {
    const task = await publishing(fixture);
    const completion = publish(fixture, task).catch(() => null);
    await entered.promise;
    const before = (await rows(fixture))[0];
    assert.equal(before.settled, false);
    assert.equal((await stats(fixture, before)).observation.state, "available");
    await fixture.restart();
    await completion;
    release.resolve();
    const restored = (await rows(fixture))[0];
    assert.equal(restored.settled, false);
    assert.equal(
      (await current(fixture, task)).state,
      "running",
      "The process vanished before committing an outcome",
    );
    await fixture.control({ action: "time", now: NOW + 60000 });
    const result = await reconcile(fixture);
    assert.equal(result.outcome, "completed");
    const resumed = await current(fixture, task);
    assert.equal(resumed.usage.toolCalls, 1);
    assert.equal(resumed.usage.reservedToolCalls, 0);
    assert.equal(resumed.operations.length, 1);
    assert.equal((await stats(fixture, result)).stats.calls, 1);
  } finally {
    release.resolve();
    await fixture.close();
  }
});

test("concurrent publication and reconciliation wakeups cannot duplicate an effect or replace its source", async () => {
  const fixture = await taskFixture({ services: true });
  try {
    const task = await publishing(fixture);
    await Promise.all(Array.from({ length: 6 }, () => publish(fixture, task)));
    const row = (await rows(fixture))[0];
    assert.equal(row.outcome, "completed");
    assert.equal((await stats(fixture, row)).stats.calls, 1);
    const fresh = await current(fixture, task);
    expectStatus(
      await fixture.control({
        action: "publish",
        id: task.id,
        source: source + "\n// changed",
        guard: guard(fresh),
      }),
      409,
    );
    expectStatus(
      await fixture.request("/__test", {
        session: fixture.otherCookie,
        body: { action: "publish", id: task.id, source, guard: guard(fresh) },
      }),
      409,
    );
    await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: fresh.revision },
    });
    const all = await Promise.all(
      Array.from({ length: 4 }, () => reconcile(fixture)),
    );
    assert.ok(all.every((value) => value.cancelled));
    assert.equal((await stats(fixture, row)).observation.state, "deleted");
    assert.equal((await current(fixture, task)).usage.toolCalls, 1);
  } finally {
    await fixture.close();
  }
});

test("confirmed cancellation of a missing identity permits a new attempt without reopening the old one", async () => {
  let failCreate = true;
  const fixture = await taskFixture({
    services: true,
    providerControl: async (request) => {
      const { phase, action } = await request.json();
      return Response.json({
        fail: failCreate && phase === "before" && action === "publish",
      });
    },
  });
  try {
    const task = await publishing(fixture);
    const row = (await publish(fixture, task)).body;
    assert.equal(row.outcome, null);
    assert.equal((await stats(fixture, row)).observation.state, "missing");
    const absent = await reconcile(fixture);
    assert.equal(absent.outcome, "absent");
    assert.equal(absent.cancelled, true);
    assert.equal((await stats(fixture, row)).observation.state, "deleted");
    const fresh = await current(fixture, task);
    expectStatus(
      await fixture.request(path(task) + "/resume", {
        body: { expectedRevision: fresh.revision },
      }),
      200,
    );
    expectStatus(
      await fixture.control({
        action: "step",
        id: task.id,
        command: { kind: "claim", claimId: "new-attempt", leaseMs: 60000 },
      }),
      200,
    );
    failCreate = false;
    const created = await publish(fixture, await current(fixture, task));
    expectStatus(created, 200);
    assert.equal(created.body.outcome, "completed");
    assert.notEqual(
      created.body.identity.resourceId,
      absent.identity.resourceId,
    );
    assert.equal((await stats(fixture, created.body)).stats.calls, 1);
    assert.equal((await stats(fixture, row)).stats.sourcePresent, false);
  } finally {
    await fixture.close();
  }
});

test("Stop arriving during reconciliation cancels the original release and never resumes the task", async () => {
  const entered = deferred(),
    release = deferred();
  const fixture = await taskFixture({
    services: true,
    providerControl: async (request) => {
      const { phase, action } = await request.json();
      if (action === "lookup" && phase === "after") {
        entered.resolve();
        await release.promise;
      }
      return Response.json({ fail: action === "publish" && phase === "after" });
    },
  });
  try {
    const task = await publishing(fixture);
    const original = (await publish(fixture, task)).body;
    const recovery = reconcile(fixture);
    await entered.promise;
    const fresh = await current(fixture, task);
    expectStatus(
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: fresh.revision },
      }),
      200,
    );
    release.resolve();
    const result = await recovery;
    assert.equal(result.cancelled, true);
    assert.equal(result.outcome, "completed");
    assert.equal((await current(fixture, task)).state, "stopped");
    assert.equal((await stats(fixture, original)).observation.state, "deleted");
    assert.equal((await stats(fixture, original)).stats.calls, 1);
  } finally {
    release.resolve();
    await fixture.close();
  }
});

test("failed cleanup retains private bookkeeping past retention, then removes it only after verified deletion", async () => {
  let failCancel = true;
  const fixture = await taskFixture({
    services: true,
    providerControl: async (request) => {
      const { action } = await request.json();
      return Response.json({ fail: action === "cancel" && failCancel });
    },
  });
  try {
    const task = await publishing(fixture);
    const original = (await publish(fixture, task)).body;
    const fresh = await current(fixture, task);
    await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: fresh.revision },
    });
    await reconcile(fixture);
    await fixture.control({ action: "time", now: task.expiresAt + 1 });
    expectStatus(await fixture.request(path(task)), 404);
    assert.equal(
      (await fixture.control({ action: "inspect" })).body.records.length,
      1,
    );
    failCancel = false;
    expectStatus(await fixture.control({ action: "sweep" }), 200);
    assert.equal((await stats(fixture, original)).observation.state, "deleted");
    assert.equal(
      (await fixture.control({ action: "inspect" })).body.records.length,
      0,
    );
    assert.equal((await rows(fixture)).length, 0);
  } finally {
    await fixture.close();
  }
});

test("an unavailable provider has bounded retries, no alarm loop and no false success or erasure", async () => {
  const fixture = await taskFixture({ services: true });
  try {
    const task = await publishing(fixture);
    const original = (await publish(fixture, task)).body;
    const fresh = await current(fixture, task);
    await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: fresh.revision },
    });
    await fixture.control({ action: "disable-provider" });
    let now = NOW;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const row = await reconcile(fixture);
      assert.equal(row.attempts, attempt);
      assert.equal(row.cancelled, false);
      if (attempt < 5) {
        assert.ok(row.nextAt > now);
        now = row.nextAt;
        await fixture.control({ action: "time", now });
      } else assert.equal(row.nextAt, null);
    }
    await fixture.control({ action: "time", now: task.expiresAt + 1 });
    const swept = await fixture.control({ action: "sweep" });
    expectStatus(swept, 200);
    assert.equal(swept.body.alarm, null);
    assert.equal(swept.body.records.length, 1);
    assert.equal((await rows(fixture))[0].attempts, 5);
    assert.equal((await stats(fixture, original)).stats.calls, 1);
  } finally {
    await fixture.close();
  }
});

test("an exhausted failed task still wakes at its deadline to close the owned provider identity", async () => {
  let failLookup = true;
  const fixture = await taskFixture({
    services: true,
    providerControl: async (request) => {
      const { phase, action } = await request.json();
      return Response.json({
        fail:
          (action === "publish" && phase === "after") ||
          (action === "lookup" && failLookup),
      });
    },
  });
  try {
    const task = await publishing(fixture);
    const original = (await publish(fixture, task)).body;
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await reconcile(fixture);
      if (row.nextAt !== null)
        await fixture.control({ action: "time", now: row.nextAt });
    }
    const exhausted = (await fixture.control({ action: "inspect" })).body;
    assert.equal(exhausted.alarm, task.deadlineAt);
    failLookup = false;
    await fixture.control({ action: "time", now: task.deadlineAt });
    expectStatus(await fixture.control({ action: "sweep" }), 200);
    assert.equal((await stats(fixture, original)).observation.state, "deleted");
    const row = (await rows(fixture))[0];
    assert.equal(row.settled, true);
    assert.equal(row.cancelled, true);
    assert.equal((await current(fixture, task)).usage.reservedToolCalls, 0);
  } finally {
    await fixture.close();
  }
});
