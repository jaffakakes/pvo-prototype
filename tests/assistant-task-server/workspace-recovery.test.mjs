import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, path, NOW, expectStatus } from "./helpers.mjs";
import {
  building,
  operate,
  current,
  files,
  command,
  rows,
  reconcile,
  status,
  prepare,
  deferred,
} from "./workspace.helpers.mjs";
const options = { timeout: 20000 };

test(
  "restarting the task runtime recovers a lost command receipt, with one execution and charge",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    const fixture = await taskFixture({
      workspaces: true,
      workspaceControl: async (request) => {
        const value = await request.json();
        if (
          value.action === "operate" &&
          value.phase === "after" &&
          value.request?.id === "test-one"
        ) {
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const task = await building(fixture);
      const { identity, reference } = await prepare(fixture, task, files());
      const pending = operate(
        fixture,
        task,
        "command",
        command(reference),
      ).catch(() => null);
      await entered.promise;
      assert.equal((await rows(fixture)).operations[2].settled, false);
      await fixture.restart();
      await pending;
      release.resolve();
      assert.equal((await current(fixture, task)).state, "running");
      await fixture.control({ action: "time", now: NOW + 60000 });
      const recovered = await reconcile(fixture);
      assert.equal(recovered.operations[2].receipt.status, "completed");
      const observed = await status(fixture, identity);
      assert.equal(observed.stats.vm.executions, 1);
      assert.equal(observed.stats.vm.running, false);
      assert.deepEqual(observed.observation.source.files, files());
      assert.equal((await current(fixture, task)).usage.toolCalls, 3);
      assert.equal((await current(fixture, task)).usage.reservedToolCalls, 0);
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);

test(
  "Stop fences a delayed start before arrival and lookup never retries it",
  options,
  async () => {
    const entered = deferred(),
      release = deferred(),
      arrived = deferred();
    const fixture = await taskFixture({
      workspaces: true,
      workspaceControl: async (request) => {
        const value = await request.json();
        if (
          value.action === "operate" &&
          value.phase === "before" &&
          value.request?.id === "start"
        ) {
          entered.resolve();
          await release.promise;
          arrived.resolve();
        }
        return Response.json({});
      },
    });
    try {
      const task = await building(fixture);
      const save = await operate(fixture, task, "save", {
        id: "save",
        expectedRevision: 0,
        files: files(),
      });
      expectStatus(save, 200);
      const start = operate(fixture, task, "start", {
        id: "start",
        ...save.body.receipt.result,
      });
      await entered.promise;
      const fresh = await current(fixture, task);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: fresh.revision },
        }),
        200,
      );
      const interrupted = await start;
      assert.equal(interrupted.body.settled, false);
      const reconciled = await reconcile(fixture);
      assert.equal(reconciled.operations[1].settled, true);
      assert.equal(reconciled.operations[1].receipt, null);
      assert.equal(reconciled.links[0].cleaned, true);
      release.resolve();
      await arrived.promise;
      const observed = await status(fixture, save.body.identity);
      assert.equal(observed.observation.closed, true);
      assert.equal(observed.stats.vm.starts, 0);
      assert.deepEqual(observed.observation.source.files, files());
      const stopped = await current(fixture, task);
      assert.equal(stopped.state, "stopped");
      assert.equal(stopped.operations[1].status, "absent");
      assert.equal(stopped.usage.toolCalls, 2);
      assert.equal(stopped.usage.reservedToolCalls, 0);
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);

test(
  "Stop during a running command preserves its interrupted receipt and source",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    const fixture = await taskFixture({
      workspaces: true,
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "execute") {
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const task = await building(fixture);
      const { reference, identity } = await prepare(fixture, task, files());
      const running = operate(fixture, task, "command", command(reference));
      await entered.promise;
      const fresh = await current(fixture, task);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: fresh.revision },
        }),
        200,
      );
      await running;
      const recovered = await reconcile(fixture);
      assert.equal(recovered.operations[2].receipt.status, "interrupted");
      release.resolve();
      const observed = await status(fixture, identity);
      assert.equal(observed.stats.vm.running, false);
      assert.equal(observed.observation.closed, true);
      assert.deepEqual(observed.observation.source.files, files());
      const stopped = await current(fixture, task);
      assert.equal(stopped.state, "stopped");
      assert.equal(stopped.operations[2].status, "failed");
      assert.equal(stopped.usage.toolCalls, 3);
      assert.equal(stopped.usage.reservedToolCalls, 0);
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);

test(
  "unknown cleanup survives retention with bounded retries and no alarm loop",
  options,
  async () => {
    const fixture = await taskFixture({ workspaces: true });
    try {
      const task = await building(fixture);
      await prepare(fixture, task, files());
      const fresh = await current(fixture, task);
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: fresh.revision },
      });
      await fixture.control({ action: "disable-workspaces" });
      let now = NOW;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const { links } = await reconcile(fixture);
        assert.equal(links[0].attempts, attempt);
        assert.equal(links[0].cleaned, false);
        if (attempt < 5) {
          assert.ok(links[0].nextAt > now);
          now = links[0].nextAt;
          await fixture.control({ action: "time", now });
        } else assert.equal(links[0].nextAt, null);
      }
      await fixture.control({ action: "time", now: task.expiresAt + 1 });
      const swept = await fixture.control({ action: "sweep" });
      expectStatus(swept, 200);
      assert.equal(swept.body.alarm, null);
      assert.equal(swept.body.records.length, 1);
      const retained = await rows(fixture);
      assert.equal(retained.links[0].attempts, 5);
      assert.ok(
        retained.operations.every((row) => row.receipt === null),
        "Expired private output is erased while cleanup bookkeeping remains",
      );
      expectStatus(await fixture.request(path(task)), 404);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "task deadline closes the workspace and confirmed cleanup allows retention removal",
  options,
  async () => {
    const fixture = await taskFixture({ workspaces: true });
    try {
      const task = await building(fixture);
      const { identity } = await prepare(fixture, task, files());
      await fixture.control({ action: "time", now: task.deadlineAt });
      expectStatus(await fixture.control({ action: "sweep" }), 200);
      const observed = await status(fixture, identity);
      assert.equal(observed.observation.closed, true);
      assert.equal(observed.stats.vm.running, false);
      assert.equal((await rows(fixture)).links[0].cleaned, true);
      assert.equal(
        (await current(fixture, task)).failure.code,
        "deadline_exceeded",
      );
      await fixture.control({ action: "time", now: task.expiresAt + 1 });
      const expired = await fixture.control({ action: "sweep" });
      expectStatus(expired, 200);
      assert.equal(expired.body.records.length, 0);
      assert.deepEqual(await rows(fixture), { operations: [], links: [] });
    } finally {
      await fixture.close();
    }
  },
);

test(
  "a failed cleanup is retried at its saved wakeup and then releases the owned computer",
  options,
  async () => {
    let failDestroy = true;
    const fixture = await taskFixture({
      workspaces: true,
      workspaceEffects: async (request) =>
        Response.json({
          fail: (await request.json()).kind === "destroy" && failDestroy,
        }),
    });
    try {
      const task = await building(fixture);
      const { identity } = await prepare(fixture, task, files());
      const fresh = await current(fixture, task);
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: fresh.revision },
      });
      const failed = await reconcile(fixture);
      assert.equal(failed.links[0].cleaned, false);
      assert.equal(failed.links[0].attempts, 1);
      assert.ok(failed.links[0].nextAt > NOW);
      failDestroy = false;
      await fixture.control({ action: "time", now: failed.links[0].nextAt });
      const restored = await reconcile(fixture);
      assert.equal(restored.links[0].cleaned, true);
      const observed = await status(fixture, identity);
      assert.equal(observed.stats.vm.running, false);
      assert.equal(observed.observation.lease, null);
      assert.deepEqual(observed.observation.source.files, files());
    } finally {
      await fixture.close();
    }
  },
);
