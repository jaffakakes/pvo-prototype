import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, path, NOW, expectStatus } from "./helpers.mjs";
import {
  source,
  guard,
  publishing,
  publish,
  current,
  stats,
  deferred,
} from "./provider.helpers.mjs";

test("completed publication survives restart and a new claim without another provider create", async () => {
  const fixture = await taskFixture({ services: true });
  try {
    const task = await publishing(fixture);
    const response = await publish(fixture, task);
    expectStatus(response, 200);
    const row = response.body;
    assert.equal(row.outcome, "completed");
    assert.equal(
      row.source,
      null,
      "Settled coordinator records do not retain another source copy",
    );
    let fresh = await current(fixture, task);
    assert.equal(fresh.operations.at(-1).status, "completed");
    assert.equal(fresh.usage.toolCalls, 1);
    assert.equal(fresh.usage.reservedToolCalls, 0);
    await fixture.restart();
    fresh = await current(fixture, task);
    expectStatus(await publish(fixture, fresh), 200);
    assert.equal((await stats(fixture, row)).stats.calls, 1);
    const probe = await fixture.control({
      action: "provider-probe",
      identity: row.identity,
      input: { value: 21 },
    });
    expectStatus(probe, 200);
    assert.equal(JSON.parse(probe.body.body).answer, 42);
    await fixture.control({ action: "time", now: NOW + 60000 });
    await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "recover" },
    });
    await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "claim", claimId: "recovered", leaseMs: 60000 },
    });
    fresh = await current(fixture, task);
    expectStatus(await publish(fixture, fresh), 200);
    assert.equal((await stats(fixture, row)).stats.calls, 1);
  } finally {
    await fixture.close();
  }
});

test("a lost create reply is reconciled from the original owned service; unavailable lookup proves no absence", async () => {
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
    const response = await publish(fixture, task);
    expectStatus(response, 200);
    let row = response.body;
    assert.equal(row.settled, false);
    assert.equal((await stats(fixture, row)).observation.state, "available");
    assert.equal(
      (await current(fixture, task)).failure.code,
      "reconciliation_required",
    );
    await fixture.restart();
    row = (await fixture.control({ action: "provider-reconcile" })).body[0];
    assert.equal(row.settled, false);
    assert.equal(row.cancelRequested, false);
    assert.equal(row.attempts, 1);
    assert.equal((await stats(fixture, row)).stats.calls, 1);
    failLookup = false;
    await fixture.control({ action: "time", now: NOW + 60000 });
    row = (await fixture.control({ action: "provider-reconcile" })).body[0];
    assert.equal(row.outcome, "completed");
    assert.equal((await stats(fixture, row)).stats.calls, 1);
    const fresh = await current(fixture, task);
    expectStatus(
      await fixture.request(path(task) + "/resume", {
        body: { expectedRevision: fresh.revision },
      }),
      200,
    );
    await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "claim", claimId: "resumed", leaseMs: 60000 },
    });
    expectStatus(await publish(fixture, await current(fixture, task)), 200);
    assert.equal((await stats(fixture, row)).stats.calls, 1);
  } finally {
    await fixture.close();
  }
});

test("Stop during a dispatched publication records cancellation before a delayed provider can create", async () => {
  const entered = deferred(),
    release = deferred();
  const fixture = await taskFixture({
    services: true,
    providerControl: async (request) => {
      const { phase, action } = await request.json();
      if (phase === "before" && action === "publish") {
        entered.resolve();
        await release.promise;
      }
      return Response.json({ fail: false });
    },
  });
  try {
    const task = await publishing(fixture);
    const completion = publish(fixture, task);
    await entered.promise;
    const fresh = await current(fixture, task);
    expectStatus(
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: fresh.revision },
      }),
      200,
    );
    await completion;
    const rows = await fixture.control({ action: "provider-reconcile" });
    expectStatus(rows, 200);
    const row = rows.body[0];
    assert.equal(row.cancelled, true);
    assert.equal(row.outcome, "absent");
    release.resolve();
    // The delayed request still reaches the actual provider and must observe the tombstone.
    for (
      let index = 0;
      index < 20 && (await stats(fixture, row)).stats.calls === 0;
      index++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    const provider = await stats(fixture, row);
    assert.equal(provider.observation.state, "deleted");
    assert.equal(provider.stats.sourcePresent, false);
    assert.equal((await current(fixture, task)).state, "stopped");
  } finally {
    release.resolve();
    await fixture.close();
  }
});

test("Stop after a completed effect retains its immutable receipt and cleans only the owned inactive service", async () => {
  const fixture = await taskFixture({ services: true });
  try {
    const task = await publishing(fixture);
    const row = (await publish(fixture, task)).body;
    const before = await current(fixture, task);
    await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: before.revision },
    });
    const reconciled = (await fixture.control({ action: "provider-reconcile" }))
      .body[0];
    assert.equal(reconciled.cancelled, true);
    assert.equal(reconciled.outcome, "completed");
    assert.equal((await stats(fixture, row)).observation.state, "deleted");
    assert.deepEqual(
      (await current(fixture, task)).operations,
      before.operations,
    );
  } finally {
    await fixture.close();
  }
});
