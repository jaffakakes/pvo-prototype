import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  hosted,
  action,
  call,
  publicCall,
  inspect,
  status,
  control,
  deferred,
  current,
} from "./helpers.mjs";
const options = { timeout: 25000 };

test(
  "owned HTTP lifecycle controls replay across restart, reject stale/changed/foreign commands and preserve live records on pause",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f),
        id = service.identity.serviceId;
      const before = await status(f, service);
      expectStatus(before, 200);
      expectStatus(await status(f, service, { session: f.otherCookie }), 404);
      expectStatus(await status(f, service, { session: null }), 401);
      expectStatus(await call(f, service, action("test-data")), 200);
      const command = {
        kind: "activate",
        actionId: "activate-once",
        expectedRevision: before.body.summary.service.revision,
        releaseId: service.identity.resourceId,
      };
      const path = `/api/services/${id}/activate`;
      expectStatus(
        await f.request(path, { body: command, session: f.otherCookie }),
        404,
      );
      expectStatus(
        await f.request(path, {
          body: command,
          headers: { Origin: "https://foreign.test" },
        }),
        403,
      );
      const first = await f.request(path, { body: command });
      expectStatus(first, 200);
      assert.equal(first.body.summary.service.state, "active");
      assert.equal(first.body.summary.releases[0].state, "retained");
      assert.equal(
        (await publicCall(f, service, action("live-data", "Bob"))).body.result,
        "accepted",
      );
      await f.restart();
      assert.deepEqual(
        (await f.request(path, { body: command })).body,
        first.body,
      );
      expectStatus(
        await f.request(path, { body: { ...command, releaseId: "changed" } }),
        409,
      );
      expectStatus(
        await control(f, service, "pause", {
          body: { expectedRevision: command.expectedRevision },
        }),
        409,
      );
      expectStatus(await control(f, service, "pause"), 200);
      expectStatus(await publicCall(f, service, action("paused")), 404);
      const replay = await f.request(path, { body: command });
      expectStatus(replay, 200);
      assert.deepEqual(replay.body.receipt, first.body.receipt);
      assert.equal(
        replay.body.summary.service.state,
        "paused",
        "Replay does not lie about the current state",
      );
      expectStatus(await control(f, service, "activate"), 200);
      assert.equal(
        (await publicCall(f, service, action("another"))).body.result,
        "full",
      );
      const records = await f.request(`/api/services/${id}/operate`, {
        body: { actionId: "read-live", operation: "guests", input: null },
      });
      expectStatus(records, 200);
      assert.deepEqual(records.body.result, ["Bob"]);
      const list = await f.request("/api/services");
      expectStatus(list, 200);
      assert.equal(list.body.services[0].metadata.state, "active");
      assert.equal(
        list.body.services[0].summary.service.identity.serviceId,
        id,
      );
      assert.deepEqual(
        (await f.request("/api/services", { session: f.otherCookie })).body
          .services,
        [],
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "activated and paused services survive task Stop, expiry, pruning and full restart until explicit deletion",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f);
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await publicCall(f, service, action("saved")), 200);
      const task = await current(f, service.task);
      expectStatus(
        await f.request(`/api/assistant/tasks/${task.id}/stop`, {
          body: { expectedRevision: task.revision },
        }),
        200,
      );
      const reconciled = await f.control({ action: "provider-reconcile" });
      expectStatus(reconciled, 200);
      assert.equal(reconciled.body[0].retained, true);
      assert.equal(
        reconciled.body[0].cancelled,
        false,
        "Retained is not falsely reported as deleted",
      );
      expectStatus(await control(f, service, "pause"), 200);
      await f.control({
        action: "time",
        now: service.identity.expiresAt + 40 * 86400000,
      });
      await inspect(f, service); // Advance the host test clock as well.
      await f.request("/api/assistant/tasks");
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(await f.request(`/api/assistant/tasks/${task.id}`), 404);
      assert.equal(
        (await publicCall(f, service, action("future", "Bob"))).body.result,
        "full",
      );
      await f.restart();
      assert.equal(
        (await publicCall(f, service, action("new", "Bob"))).body.result,
        "full",
      );
      const removed = await control(f, service, "delete");
      expectStatus(removed, 200);
      assert.equal(removed.body.summary.service.state, "deleted");
      assert(
        removed.body.summary.releases.every((item) => item.state === "deleted"),
      );
      expectStatus(await publicCall(f, service, action("new", "Bob")), 404);
      expectStatus(await control(f, service, "activate"), 404);
      const data = await inspect(f, service);
      assert.deepEqual(data.data, []);
      assert.deepEqual(data.receipts, []);
      assert.deepEqual(data.usage, []);
      assert.deepEqual((await f.request("/api/services")).body.services, []);
      const provider = await f.control({
        action: "provider-status",
        identity: service.identity,
      });
      expectStatus(provider, 200);
      assert.equal(provider.body.stats.sourcePresent, false);
    } finally {
      await f.close();
    }
  },
);

for (const kind of ["pause", "delete"])
  test(
    `${kind} fences an in-flight live execution without a late commit`,
    options,
    async () => {
      const entered = deferred(),
        release = deferred();
      const f = await taskFixture({
        services: true,
        hostControl: async () => {
          entered.resolve();
          await release.promise;
          return Response.json({});
        },
      });
      try {
        const service = await hosted(f);
        expectStatus(await control(f, service, "activate"), 200);
        const pending = publicCall(f, service, action("in-flight"));
        await entered.promise;
        expectStatus(await control(f, service, kind), 200);
        release.resolve();
        assert.notEqual((await pending).status, 200);
        const data = await inspect(f, service);
        if (kind === "delete") assert.deepEqual(data.data, []);
        else
          assert.deepEqual(
            data.data.map((row) => JSON.parse(row.body)),
            [{ capacity: 1, guests: [] }],
          );
        assert.deepEqual(data.receipts, []);
      } finally {
        release.resolve();
        await f.close();
      }
    },
  );

test(
  "control receipt window stays bounded and old stale controls never reactivate a service",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f);
      const first = await status(f, service);
      const original = {
        kind: "activate",
        actionId: "old",
        expectedRevision: first.body.summary.service.revision,
        releaseId: service.identity.resourceId,
      };
      expectStatus(
        await f.request(
          `/api/services/${service.identity.serviceId}/activate`,
          { body: original },
        ),
        200,
      );
      for (let i = 0; i < 65; i++)
        expectStatus(
          await control(f, service, i % 2 ? "activate" : "pause"),
          200,
        );
      expectStatus(
        await f.request(
          `/api/services/${service.identity.serviceId}/activate`,
          { body: original },
        ),
        409,
      );
      assert.equal(
        (await status(f, service)).body.summary.service.state,
        "paused",
      );
      assert.equal((await inspect(f, service)).controls, 64);
      expectStatus(await control(f, service, "delete"), 200);
    } finally {
      await f.close();
    }
  },
);
