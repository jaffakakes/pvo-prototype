import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  path,
} from "../assistant-task-server/helpers.mjs";
import {
  publishing,
  publish,
  current,
  guard,
  deferred,
} from "../assistant-task-server/provider.helpers.mjs";
import { attachment } from "./fixtures.mjs";

async function prepared(f) {
  let task = await publishing(f);
  expectStatus(await publish(f, task), 200);
  task = await current(f, task);
  for (const command of [
    { kind: "checkpoint", stepId: "attach" },
    { kind: "claim", claimId: "attacher", leaseMs: 60000 },
  ]) {
    const result = await f.control({ action: "step", id: task.id, command });
    expectStatus(result, 200);
    task = result.body;
  }
  const row = (await f.control({ action: "provider-rows" })).body[0];
  return { task, row, command: attachment(row.identity.resourceId) };
}
const resolve = (f, value) =>
  f.control({
    action: "attachment",
    id: value.task.id,
    guard: guard(value.task),
    command: value.command,
  });

test(
  "private attachment resolution reads actual owned checked bytes and hosted readiness, including after a full restart",
  { timeout: 20000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const value = await prepared(f);
      const first = await resolve(f, value);
      expectStatus(first, 200);
      assert.equal(
        first.body.receipt.identity.resourceId,
        value.row.identity.resourceId,
      );
      assert.equal(first.body.receipt.operation.audience, "public");
      assert.equal(first.body.receipt.readiness.state, "available");
      assert.equal(
        (await current(f, value.task)).result,
        null,
        "readiness does not mark a component ready or activate it",
      );
      await f.restart();
      const recovered = await resolve(f, value);
      expectStatus(recovered, 200);
      assert.deepEqual(recovered.body, first.body);
      expectStatus(
        await f.request("/__test", {
          session: f.otherCookie,
          body: {
            action: "attachment",
            id: value.task.id,
            guard: guard(value.task),
            command: value.command,
          },
        }),
        409,
      );
      expectStatus(
        await resolve(f, {
          ...value,
          command: {
            ...value.command,
            connection: { ...value.command.connection, operation: "guests" },
          },
        }),
        409,
      );
      expectStatus(
        await resolve(f, {
          ...value,
          command: {
            ...value.command,
            connection: { ...value.command.connection, releaseId: "invented" },
          },
        }),
        409,
      );
      await f.control({ action: "disable-provider" });
      expectStatus(await resolve(f, value), 409);
    } finally {
      await f.close();
    }
  },
);

test(
  "Stop while provider readiness is in flight cannot deliver a late attachment receipt",
  { timeout: 20000 },
  async () => {
    const entered = deferred(),
      release = deferred();
    let holding = false;
    const f = await taskFixture({
      services: true,
      providerControl: async (request) => {
        const value = await request.json();
        if (holding && value.action === "lookup" && value.phase === "after") {
          holding = false;
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const value = await prepared(f);
      holding = true;
      const pending = resolve(f, value);
      await entered.promise;
      const task = await current(f, value.task);
      expectStatus(
        await f.request(`${path(task)}/stop`, {
          body: {
            expectedRevision: task.revision,
          },
        }),
        200,
      );
      release.resolve();
      expectStatus(await pending, 409);
      assert.equal((await current(f, task)).result, null);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);
