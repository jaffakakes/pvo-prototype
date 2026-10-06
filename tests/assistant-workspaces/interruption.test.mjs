import assert from "node:assert/strict";
import test from "node:test";
import { identity, NOW, files, command, workspaceFixture } from "./helpers.mjs";

const ok = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.result;
};
async function saved(f, who) {
  return ok(
    await f.call("save", who, {
      id: "save",
      expectedRevision: 0,
      files: files(),
    }),
  ).result;
}

test("a real coordinator abort during restoration recovers the same identity and marks the old operation interrupted", async () => {
  let arrived, release;
  const pending = new Promise((resolve) => (release = resolve));
  const arrival = new Promise((resolve) => (arrived = resolve));
  let block = true;
  const f = await workspaceFixture(async (request) => {
    if ((await request.json()).kind === "restore" && block) {
      arrived();
      await pending;
    }
    return Response.json({});
  });
  const who = await identity();
  try {
    const source = await saved(f, who);
    const starting = f
      .call("start", who, { id: "start-one", ...source })
      .catch(() => null);
    await arrival;
    await f.call("crash", who).catch(() => null);
    block = false;
    release();
    await starting;
    await f.restart();
    const recovered = ok(await f.call("lookup", who));
    assert.deepEqual(recovered.source.files, files());
    assert.equal(recovered.lease, null);
    assert.equal(
      ok(await f.call("start", who, { id: "start-one", ...source })).status,
      "interrupted",
    );
    assert.equal(ok(await f.call("inspect", who)).vm.starts, 1);
    assert.equal(
      ok(await f.call("start", who, { id: "start-two", ...source })).status,
      "completed",
    );
    assert.equal(ok(await f.call("inspect", who)).vm.starts, 2);
  } finally {
    release();
    await f.close();
  }
});

test("a wall deadline cleans up a command even if the provider ignores cancellation", async () => {
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  const f = await workspaceFixture(async (request) => {
    if ((await request.json()).kind === "execute") await blocked;
    return Response.json({});
  });
  const who = { ...(await identity()), deadlineAt: NOW + 100 };
  try {
    const source = await saved(f, who);
    ok(await f.call("start", who, { id: "start", ...source }));
    const receipt = ok(await f.call("execute", who, command(source)));
    assert.equal(receipt.status, "interrupted");
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
    assert.equal(
      ok(await f.call("inspect", who, null, { budget: true }))[0].released,
      true,
    );
    release();
    assert.equal(
      ok(await f.call("execute", who, command(source))).status,
      "interrupted",
    );
  } finally {
    release();
    await f.close();
  }
});

test("a command failure saves its actual exit code while a task deadline closes the workspace", async () => {
  const f = await workspaceFixture(async () => Response.json({ exitCode: 7 }));
  const who = await identity();
  try {
    const source = await saved(f, who);
    ok(await f.call("start", who, { id: "start", ...source }));
    const result = ok(await f.call("execute", who, command(source)));
    assert.equal(result.status, "completed");
    assert.equal(result.result.exitCode, 7);
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
    ok(await f.call("time", who, null, { now: who.deadlineAt }));
    const closed = ok(await f.call("lookup", who));
    assert.equal(closed.closed, true);
    assert.deepEqual(closed.source.files, files());
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
    assert.equal(
      (await f.call("start", who, { id: "late", ...source })).status,
      409,
    );
  } finally {
    await f.close();
  }
});
