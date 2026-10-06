import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  taskFixture,
  saved,
  path,
  current,
  until,
  planner,
  deferred,
  expectStatus,
  validation,
} from "../service-validation/task.helpers.mjs";
import {
  publishing,
  guard,
} from "../assistant-task-server/provider.helpers.mjs";
const options = { timeout: 25000 };
const catalog = async (f) =>
  (await f.control({ action: "service-catalog" })).body;
const rows = async (f) => (await f.control({ action: "provider-rows" })).body;

test(
  "the real builder gate creates an owned inactive release that runs independently of its workspace and retains exact metadata",
  options,
  async () => {
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner(),
    });
    try {
      const task = await saved(f);
      const end = await until(
        () => current(f, task),
        (value) => value.state === "failed",
      );
      assert.equal(end.stepId, "attach");
      assert.equal(end.result, null);
      assert.equal(end.usage.toolCalls, 4);
      const entries = await catalog(f);
      assert.equal(entries.length, 1);
      const { service, releases } = entries[0],
        release = releases[0];
      assert.equal(service.state, "inactive");
      assert.equal(release.state, "inactive");
      assert.equal(service.identity.ownerId, task.ownerId);
      assert.equal(service.identity.projectId, task.input.projectId);
      assert.deepEqual(release.permissions, [
        { name: "join", audience: "public", access: "write" },
        { name: "guests", audience: "creator", access: "read" },
      ]);
      const checked = (await validation(f, task)).artifacts[0];
      for (const key of ["agreementDigest", "packageDigest", "sourceDigest"])
        assert.equal(release.identity[key], checked.artifact.identity[key]);
      assert.match(release.identity.reportDigest, /^[a-f0-9]{64}$/);
      assert.equal((await rows(f))[0].publication, null);
      assert.deepEqual(
        (
          await f.request("/__test", {
            session: f.otherCookie,
            body: { action: "service-catalog" },
          })
        ).body,
        [],
      );
      await f.restart();
      assert.deepEqual(await catalog(f), entries);
      await f.control({ action: "disable-workspaces" });
      const call = await f.control({
        action: "provider-probe",
        identity: release.identity,
        input: { operation: "join", input: { name: "Alice" } },
      });
      expectStatus(call, 200);
      assert.deepEqual(JSON.parse(call.body.body), {
        result: "accepted",
        state: { capacity: 1, guests: ["Alice"] },
      });
      const stopped = await f.request(path(task) + "/stop", {
        body: { expectedRevision: (await current(f, task)).revision },
      });
      expectStatus(stopped, 200);
      await f.control({ action: "time", now: stopped.body.task.expiresAt + 1 });
      await f.control({ action: "sweep" });
      const retained = await catalog(f);
      assert.equal(retained[0].service.state, "deleted");
      assert.equal(retained[0].releases[0].state, "deleted");
      expectStatus(await f.request(path(task)), 404);
      assert.equal(
        (
          await f.control({
            action: "provider-status",
            identity: release.identity,
          })
        ).body.stats.sourcePresent,
        false,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "host restart after publication adopts the original release and catalog without another provider create",
  options,
  async () => {
    const entered = deferred();
    let held = false;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner(),
      providerControl: async (request) => {
        const value = await request.json();
        if (value.action === "publish" && value.phase === "after" && !held) {
          held = true;
          entered.resolve();
          await delay(2500);
        }
        return Response.json({});
      },
    });
    try {
      const task = await saved(f);
      await entered.promise;
      const before = (await rows(f))[0];
      assert.equal(before.settled, false);
      assert.equal((await catalog(f))[0].releases[0].state, "pending");
      await f.restart();
      const end = await until(
        () => current(f, task),
        (value) => value.state === "failed",
      );
      assert.equal(end.stepId, "attach", JSON.stringify(end));
      assert.equal(end.retries, 1);
      assert.equal(end.usage.toolCalls, 4);
      assert.equal(end.usage.reservedToolCalls, 0);
      const after = (await rows(f))[0];
      assert.equal(after.identity.resourceId, before.identity.resourceId);
      assert.equal(after.settled, true);
      assert.equal((await rows(f)).length, 1);
      assert.equal((await catalog(f))[0].releases[0].state, "inactive");
      assert.equal(
        (
          await f.control({
            action: "provider-status",
            identity: after.identity,
          })
        ).body.stats.calls,
        1,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "hosting rejects an unvalidated task before recording a service or contacting a provider",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const task = await publishing(f);
      expectStatus(
        await f.control({
          action: "publish-unchecked",
          id: task.id,
          guard: guard(task),
          report: { passed: true },
        }),
        409,
      );
      assert.deepEqual(await catalog(f), []);
      assert.deepEqual(await rows(f), []);
      assert.equal((await current(f, task)).usage.toolCalls, 0);
    } finally {
      await f.close();
    }
  },
);

test(
  "Stop while the real host receipt is withheld closes the release and prevents late attachment",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner(),
      providerControl: async (request) => {
        const value = await request.json();
        if (value.action === "publish" && value.phase === "after") {
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const task = await saved(f);
      await entered.promise;
      const pending = await current(f, task);
      assert.equal(pending.stepId, "host");
      expectStatus(
        await f.request(path(task) + "/stop", {
          body: { expectedRevision: pending.revision },
        }),
        200,
      );
      release.resolve();
      await f.control({ action: "provider-reconcile" });
      const row = await until(
        async () => (await rows(f))[0],
        (value) => value.cancelled,
      );
      const stopped = await current(f, task);
      assert.equal(stopped.state, "stopped");
      assert.equal(stopped.stepId, "host");
      assert.equal(stopped.result, null);
      assert.equal(stopped.usage.reservedToolCalls, 0);
      assert.equal((await catalog(f))[0].releases[0].state, "deleted");
      assert.equal(
        (await f.control({ action: "provider-status", identity: row.identity }))
          .body.stats.sourcePresent,
        false,
      );
      await f.restart();
      assert.equal((await current(f, task)).state, "stopped");
    } finally {
      release.resolve();
      await f.close();
    }
  },
);
