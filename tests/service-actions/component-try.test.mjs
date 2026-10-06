import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  hosted,
  action,
  call,
  publicCall,
  control,
  inspect,
  version,
} from "./helpers.mjs";

const componentTry = (f, service, body, options = {}) =>
  f.request(
    `/api/services/${service.identity.serviceId}/releases/${service.identity.resourceId}/try`,
    { body, ...options },
  );

test("component Try binds owner and exact test release, permits only public operations, and cannot write live data", async () => {
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
    expectStatus(
      await componentTry(f, service, action("one"), { session: null }),
      401,
    );
    expectStatus(
      await componentTry(f, service, action("one"), { session: f.otherCookie }),
      404,
    );
    expectStatus(
      await componentTry(f, service, action("one"), {
        headers: { Origin: "https://other.example" },
      }),
      403,
    );
    const wrongRelease = {
      ...service,
      identity: {
        ...service.identity,
        resourceId: "release-" + "f".repeat(64),
      },
    };
    expectStatus(await componentTry(f, wrongRelease, action("one")), 404);
    for (const extra of [
      { mode: "live" },
      { ownerId: service.task.ownerId },
      { kind: "creator" },
      { releaseId: service.identity.resourceId },
    ]) {
      expectStatus(
        await componentTry(f, service, { ...action("one"), ...extra }),
        400,
      );
    }
    expectStatus(
      await componentTry(f, service, {
        actionId: "private",
        operation: "guests",
        input: null,
      }),
      403,
    );
    expectStatus(await componentTry(f, service, action("bad", 17)), 400);
    assert.equal(executions, 0);
    const accepted = await componentTry(f, service, action("same", "Alice"));
    expectStatus(accepted, 200);
    assert.equal(accepted.body.result, "accepted");
    await f.restart();
    assert.deepEqual(
      (await componentTry(f, service, action("same", "Alice"))).body,
      accepted.body,
    );
    assert.equal(executions, 1);
    expectStatus(await control(f, service, "activate"), 200);
    const live = await publicCall(f, service, action("same", "Bob"));
    expectStatus(live, 200);
    assert.equal(live.body.result, "accepted");
    const data = await inspect(f, service);
    assert.deepEqual(
      data.data.map((row) => JSON.parse(row.body).guests),
      [["Alice"], ["Bob"]],
    );
  } finally {
    await f.close();
  }
});

test("component Try cannot replay a private creator receipt or follow an unexpected replacement release", async () => {
  const f = await taskFixture({ services: true });
  try {
    const service = await hosted(f);
    const privateAction = {
      actionId: "private-receipt",
      operation: "guests",
      input: null,
    };
    expectStatus(await call(f, service, privateAction), 200);
    expectStatus(await componentTry(f, service, privateAction), 403);
    const first = await componentTry(f, service, action("first", "Alice"));
    expectStatus(first, 200);
    const replacement = await version(f, service);
    assert.notEqual(
      replacement.identity.resourceId,
      service.identity.resourceId,
    );
    expectStatus(await componentTry(f, service, action("first", "Alice")), 404);
    const next = await componentTry(f, replacement, action("first", "Bob"));
    expectStatus(next, 200);
    assert.equal(next.body.result, "accepted");
    const data = await inspect(f, service);
    assert.equal(data.data.length, 2);
    assert.deepEqual(
      data.data.map((row) => JSON.parse(row.body).guests),
      [["Alice"], ["Bob"]],
    );
    assert.ok(data.data.every((row) => row.namespace.startsWith("test:")));
  } finally {
    await f.close();
  }
});
