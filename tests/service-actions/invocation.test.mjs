import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  taskFixture,
  expectStatus,
  hosted,
  action,
  call,
  publicCall,
  inspect,
  deferred,
  current,
} from "./helpers.mjs";
import {
  equipmentAgreement,
  equipmentSource,
} from "../service-validation/fixtures.mjs";
const options = { timeout: 25000 };

test(
  "real HTTP Try serializes competing last-place requests, keeps state private and replays across full restart",
  options,
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f);
      const requests = [action("alice", "Alice"), action("bob", "Bob")];
      const replies = await Promise.all(
        requests.map((body) => call(f, service, body)),
      );
      replies.forEach((reply) => expectStatus(reply, 200));
      assert.deepEqual(replies.map((reply) => reply.body.result).sort(), [
        "accepted",
        "full",
      ]);
      replies.forEach((reply) =>
        assert.deepEqual(Object.keys(reply.body).sort(), [
          "actionId",
          "result",
        ]),
      );
      assert.equal(executions, 2);
      await f.restart();
      for (let i = 0; i < requests.length; i++)
        assert.deepEqual(
          (await call(f, service, requests[i])).body,
          replies[i].body,
        );
      assert.equal(
        executions,
        2,
        "Saved replies must not re-execute a mutation after restart",
      );
      expectStatus(await call(f, service, action("alice", "Different")), 409);
      const stored = await inspect(f, service);
      assert.equal(stored.receipts.length, 2);
      assert.equal(JSON.parse(stored.data[0].body).guests.length, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "different equipment action IDs cannot reserve overlapping dates while an adjacent booking works",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f, {
        source: equipmentSource,
        agreement: equipmentAgreement(),
      });
      const booking = (actionId, start, end) => ({
        actionId,
        operation: "reserve",
        input: { item: "camera", start, end },
      });
      const first = await Promise.all([
        call(f, service, booking("first", "2026-10-06", "2026-10-08")),
        call(f, service, booking("second", "2026-10-07", "2026-10-09")),
      ]);
      first.forEach((reply) => expectStatus(reply, 200));
      assert.deepEqual(first.map((reply) => reply.body.result).sort(), [
        "overlap",
        "reserved",
      ]);
      assert.equal(
        (await call(f, service, booking("later", "2026-10-09", "2026-10-10")))
          .body.result,
        "reserved",
      );
      const data = await inspect(f, service);
      assert.equal(JSON.parse(data.data[0].body).bookings.length, 2);
    } finally {
      await f.close();
    }
  },
);

test(
  "owner sessions, caller mode flags, private operations and separate service/test/live records are enforced before execution",
  options,
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const one = await hosted(f),
        two = await hosted(f);
      expectStatus(await call(f, one, action("one"), { session: null }), 401);
      expectStatus(
        await call(f, one, action("one"), { session: f.otherCookie }),
        404,
      );
      expectStatus(
        await call(f, one, action("one"), {
          headers: { Origin: "https://foreign.test" },
        }),
        403,
      );
      expectStatus(await call(f, one, { ...action("one"), mode: "live" }), 400);
      expectStatus(
        await call(f, one, { ...action("one"), input: { name: 17 } }),
        400,
      );
      expectStatus(await publicCall(f, one, action("one")), 404);
      assert.equal(executions, 0);
      assert.equal(
        (await call(f, one, action("same-id"))).body.result,
        "accepted",
      );
      assert.equal(
        (await call(f, two, action("same-id"))).body.result,
        "accepted",
      );
      // Test-only trusted lifecycle fixture: product activation/control routes are a later slice.
      await inspect(f, one, "enable-live");
      const live = await publicCall(f, one, action("same-id", "Bob"));
      expectStatus(live, 200);
      assert.equal(live.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(live.body.result, "accepted");
      const prior = executions;
      expectStatus(
        await publicCall(f, one, {
          actionId: "private",
          operation: "guests",
          input: null,
        }),
        403,
      );
      assert.equal(executions, prior);
      const states = (await inspect(f, one)).data.map(
        (row) => JSON.parse(row.body).guests,
      );
      assert.deepEqual(states, [["Alice"], ["Bob"]]);
      const guests = await call(f, one, {
        actionId: "private",
        operation: "guests",
        input: null,
      });
      expectStatus(guests, 200);
      assert.deepEqual(guests.body.result, ["Alice"]);
    } finally {
      await f.close();
    }
  },
);

test(
  "an interrupted execution has no partial state or reply and the same action can finish once after full restart",
  options,
  async () => {
    const entered = deferred();
    let first = true;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        if (first) {
          first = false;
          entered.resolve();
          await delay(2200);
        }
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f);
      const pending = call(f, service, action("saved-id")).catch(() => null);
      await entered.promise;
      assert.equal((await inspect(f, service)).receipts.length, 0);
      await f.restart();
      await pending;
      const reply = await call(f, service, action("saved-id"));
      expectStatus(reply, 200);
      assert.equal(reply.body.result, "accepted");
      const data = await inspect(f, service);
      assert.equal(data.receipts.length, 1);
      assert.equal(JSON.parse(data.data[0].body).guests.length, 1);
      assert.equal(
        data.usage[0].executions,
        2,
        "The interrupted execution remains charged",
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Stop during an inactive action prevents a late state commit and deletes its private test records",
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
      const service = await hosted(f),
        pending = call(f, service, action("stopped"));
      await entered.promise;
      const task = await current(f, service.task);
      expectStatus(
        await f.request(`/api/assistant/tasks/${task.id}/stop`, {
          body: { expectedRevision: task.revision },
        }),
        200,
      );
      await f.control({ action: "provider-reconcile" });
      release.resolve();
      assert.notEqual((await pending).status, 200);
      const data = await inspect(f, service);
      assert.equal(data.receipts.length, 0);
      assert.equal(data.data.length, 0);
      expectStatus(await call(f, service, action("stopped")), 404);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "the queue rejects excess waiting actions and admitted calls still take only one place",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    let first = true;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f),
        one = call(f, service, action("one"));
      await entered.promise;
      const others = Array.from({ length: 11 }, (_, i) =>
        call(f, service, action(`queued-${i}`, `Guest-${i}`)),
      );
      await delay(200);
      release.resolve();
      const results = await Promise.all([one, ...others]);
      assert.equal(results.filter((reply) => reply.status === 200).length, 8);
      assert.equal(results.filter((reply) => reply.status === 429).length, 4);
      assert.equal(
        results.filter((reply) => reply.body.result === "accepted").length,
        1,
      );
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "a runtime reply that mutates read-only state cannot change durable records or create a success receipt",
  options,
  async () => {
    const { dinnerSource } = await import("../service-validation/fixtures.mjs");
    const source = dinnerSource.replace(
      "return {result:state.guests,state};",
      "return {result:state.guests,state:{...state,guests:[...state.guests,'Unwanted']}};",
    );
    const f = await taskFixture({ services: true });
    try {
      // Synthetic validation setup isolates the hosting reply boundary; the real independent gate rejects this source earlier.
      const service = await hosted(f, { source });
      expectStatus(await call(f, service, action("accepted")), 200);
      const before = await inspect(f, service);
      expectStatus(
        await call(f, service, {
          actionId: "bad-read",
          operation: "guests",
          input: null,
        }),
        502,
      );
      const after = await inspect(f, service);
      assert.deepEqual(after.data, before.data);
      assert.deepEqual(after.receipts, before.receipts);
      assert.equal(after.usage[0].executions, 2);
    } finally {
      await f.close();
    }
  },
);
