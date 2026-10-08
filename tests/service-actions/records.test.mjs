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
  version,
  deferred,
} from "./helpers.mjs";
import {
  parseServiceRecords,
  SERVICE_RECORD_LIMITS,
} from "../../packages/pvo-assistant/hosting/index.js";
const options = { timeout: 30000 };
const records = (f, service, options = {}) =>
  f.request(`/api/services/${service.identity.serviceId}/records`, options);
const testArea = (body) => body.areas.find((area) => area.mode === "test");

test(
  "private records snapshots separate live/test data, bound recent outcomes and retain usage across restart",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f);
      expectStatus(await records(f, service, { session: null }), 401);
      expectStatus(await records(f, service, { session: f.otherCookie }), 404);
      expectStatus(await records(f, service, { body: {} }), 405);
      const initial = await records(f, service);
      expectStatus(initial, 200);
      assert.equal(testArea(initial.body).stored, false);
      assert.deepEqual(testArea(initial.body).usage, {
        day: Math.floor(initial.body.observedAt / 86400000),
        calls: 0,
        executions: 0,
      });
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(
        await publicCall(f, service, action("live", "Live name")),
        200,
      );
      for (let i = 0; i < 8; i++)
        expectStatus(
          await call(f, service, action(`test-${i}`, "Test name")),
          200,
        );
      for (let i = 0; i < 12; i++)
        expectStatus(
          await call(f, service, {
            actionId: `invalid-${i}`,
            operation: "join",
            input: { privateSecret: "must never be logged" },
          }),
          400,
        );
      const before = await records(f, service);
      expectStatus(before, 200);
      const parsed = parseServiceRecords(before.body);
      const live = parsed.areas.find((area) => area.mode === "live");
      const tests = testArea(parsed);
      assert.deepEqual(JSON.parse(live.recordsJson).guests, ["Live name"]);
      assert.deepEqual(JSON.parse(tests.recordsJson).guests, ["Test name"]);
      assert.equal(live.usage.executions, 1);
      assert.equal(tests.usage.calls, 20);
      assert.equal(tests.usage.executions, 8);
      assert.equal(tests.receipts.count, 8);
      assert.equal(parsed.compute.state, "available");
      assert.equal(parsed.compute.periods.live.starts, 1);
      assert.equal(parsed.compute.periods.test.starts, 8);
      assert.ok(parsed.compute.estimate.completedUsd > 0);
      assert.ok(parsed.storageBytes > 0);
      assert.equal(tests.results.length, SERVICE_RECORD_LIMITS.results);
      assert.equal(tests.results[0].actionId, "test-7");
      assert.equal(tests.failures.length, SERVICE_RECORD_LIMITS.failures);
      assert.equal(tests.failures[0].code, "invalid_input");
      assert(!JSON.stringify(parsed).includes("must never be logged"));
      assert.equal(
        (await inspect(f, service)).usage.find(
          (row) => row.namespace === "live",
        ).calls,
        1,
        "inspection consumes no invocation quota",
      );
      await f.restart();
      const after = (await records(f, service)).body;
      assert.deepEqual(after.areas, before.body.areas);
      assert.deepEqual(after.service, before.body.service);
      assert.deepEqual(after.compute.periods, before.body.compute.periods);
      assert.deepEqual(after.compute.capacity, before.body.compute.capacity);
      assert.deepEqual(after.compute.estimate, before.body.compute.estimate);
      const changed = structuredClone(parsed);
      changed.areas[0].recordsJson = "not json";
      assert.throws(() => parseServiceRecords(changed));
      const forged = structuredClone(parsed);
      forged.areas[0].usage.executions = 100000;
      assert.throws(() => parseServiceRecords(forged));
      await f.control({
        action: "time",
        now: service.identity.expiresAt + 86400000,
      });
      await inspect(f, service);
      const nextDay = await records(f, service);
      assert.equal(nextDay.body.areas[0].usage.executions, 0);
      assert.equal(nextDay.body.areas[0].receipts.count, 1);
      expectStatus(await control(f, service, "delete"), 200);
      expectStatus(await records(f, service), 404);
    } finally {
      await f.close();
    }
  },
);

test(
  "test reset replays exactly after restart, preserves old replies and usage, and never clears live records",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f);
      expectStatus(await control(f, service, "activate"), 200);
      const original = await call(f, service, action("accepted-before-reset"));
      expectStatus(original, 200);
      expectStatus(
        await publicCall(f, service, action("live-before-reset", "Bob")),
        200,
      );
      const current = await status(f, service);
      const body = {
        kind: "reset_test",
        actionId: "reset-once",
        expectedRevision: current.body.summary.service.revision,
        releaseId: service.identity.resourceId,
      };
      const path = `/api/services/${service.identity.serviceId}/reset_test`;
      expectStatus(
        await f.request(path, { body, session: f.otherCookie }),
        404,
      );
      expectStatus(
        await f.request(path, {
          body,
          headers: { Origin: "https://foreign.test" },
        }),
        403,
      );
      const first = await f.request(path, { body });
      expectStatus(first, 200);
      assert.equal(first.body.summary.service.state, "active");
      const after = await records(f, service);
      const tests = testArea(after.body);
      assert.deepEqual(JSON.parse(tests.recordsJson).guests, []);
      assert.equal(tests.version, 2);
      assert.equal(tests.receipts.count, 1);
      assert.equal(tests.usage.executions, 1);
      assert.deepEqual(
        JSON.parse(
          after.body.areas.find((area) => area.mode === "live").recordsJson,
        ).guests,
        ["Bob"],
      );
      await f.restart();
      assert.deepEqual((await f.request(path, { body })).body, first.body);
      assert.deepEqual(
        (await call(f, service, action("accepted-before-reset"))).body,
        original.body,
      );
      assert.equal(
        testArea((await records(f, service)).body).version,
        2,
        "old replay does not rewrite cleared records",
      );
      expectStatus(
        await call(f, service, action("new-after-reset", "Charlie")),
        200,
      );
      assert.deepEqual(
        JSON.parse(testArea((await records(f, service)).body).recordsJson)
          .guests,
        ["Charlie"],
      );
      expectStatus(
        await f.request(path, { body: { ...body, actionId: "stale-reset" } }),
        409,
      );
      expectStatus(
        await f.request(path, { body: { ...body, releaseId: "changed" } }),
        409,
      );
      const updated = await version(f, service);
      expectStatus(
        await control(f, service, "reset_test", {
          body: { releaseId: updated.identity.resourceId },
        }),
        200,
      );
      assert.deepEqual(
        JSON.parse(testArea((await records(f, service)).body).recordsJson)
          .guests,
        ["Charlie"],
        "resetting another version is isolated",
      );
      expectStatus(await control(f, service, "pause"), 200);
      expectStatus(
        await control(f, service, "reset_test", {
          body: { releaseId: service.identity.resourceId },
        }),
        200,
      );
      assert.equal(
        (await status(f, service)).body.summary.service.state,
        "paused",
      );
      expectStatus(await control(f, service, "delete"), 200);
      expectStatus(
        await control(f, service, "reset_test", {
          body: { releaseId: service.identity.resourceId },
        }),
        404,
      );
      assert.deepEqual((await inspect(f, service)).receipts, []);
    } finally {
      await f.close();
    }
  },
);

test(
  "test reset fences an in-flight commit and retry uses the reset state",
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
      const pending = call(f, service, action("interrupted"));
      await entered.promise;
      expectStatus(
        await control(f, service, "reset_test", {
          body: { releaseId: service.identity.resourceId },
        }),
        200,
      );
      release.resolve();
      assert.notEqual((await pending).status, 200);
      const reset = testArea((await records(f, service)).body);
      assert.deepEqual(JSON.parse(reset.recordsJson).guests, []);
      assert.equal(reset.receipts.count, 0);
      assert.equal(reset.usage.executions, 1);
      expectStatus(await call(f, service, action("interrupted")), 200);
      const retried = testArea((await records(f, service)).body);
      assert.equal(retried.receipts.count, 1);
      assert.equal(retried.usage.executions, 2);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);
