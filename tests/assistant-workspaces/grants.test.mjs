import assert from "node:assert/strict";
import test from "node:test";
import {
  identity,
  NOW,
  files,
  command,
  executionGrant,
  workspaceFixture,
} from "./helpers.mjs";

const ok = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.result;
};
const save = (id = "save", expectedRevision = 0) => ({
  id,
  expectedRevision,
  files: files(),
});

test("source edits and compute require a bounded execution claim selected by the trusted runner", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    for (const execution of [
      null,
      { ...executionGrant(), expiresAt: NOW },
      { ...executionGrant(), expiresAt: NOW + 60001 },
      { ...executionGrant(), generation: 0 },
      { ...executionGrant(), ownerId: "invented" },
    ])
      assert.equal(
        (await f.call("save", who, save(), { execution })).status,
        409,
      );
    const source = ok(await f.call("save", who, save())).result;
    assert.equal(
      (
        await f.call("save", who, save("conflict", 1), {
          execution: { ...executionGrant(), id: "different-claim" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.call("save", who, save("renew", 1), {
          execution: { ...executionGrant(), expiresAt: NOW + 59999 },
        })
      ).status,
      409,
    );
    ok(await f.call("start", who, { id: "start", ...source }));
    assert.equal(
      ok(await f.call("lookup", who)).lease.deadlineAt,
      executionGrant().expiresAt,
    );
    ok(await f.call("time", who, null, { now: executionGrant().expiresAt }));
    assert.equal(ok(await f.call("lookup", who)).lease, null);
    assert.equal((await f.call("execute", who, command(source))).status, 409);
  } finally {
    await f.close();
  }
});

test("suspension before a delayed request records revocation, while a newer claim can restore the same saved work", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  const current = { execution: executionGrant(2) };
  try {
    ok(await f.call("suspend", who, 1));
    await f.restart();
    assert.equal((await f.call("save", who, save())).status, 409);
    const source = ok(await f.call("save", who, save(), current)).result;
    assert.equal(
      ok(await f.call("start", who, { id: "start", ...source }, current))
        .status,
      "completed",
    );
    const old = ok(await f.call("suspend", who, 1));
    assert.equal(old.closed, false);
    assert.equal(old.lease.session, 1);
    assert.equal(
      (await f.call("execute", who, command(source, "old"))).status,
      409,
    );
    assert.equal(
      ok(await f.call("execute", who, command(source), current)).result
        .exitCode,
      0,
    );
    assert.equal(ok(await f.call("inspect", who)).vm.executions, 1);
  } finally {
    await f.close();
  }
});

test("revoking an active claim stops its computer and late completion cannot damage a newer restored session", async () => {
  let arrive, release;
  const arrived = new Promise((resolve) => (arrive = resolve));
  const blocked = new Promise((resolve) => (release = resolve));
  let hold = true;
  const f = await workspaceFixture(async (request) => {
    if ((await request.json()).kind === "execute" && hold) {
      arrive();
      await blocked;
    }
    return Response.json({});
  });
  const who = await identity();
  try {
    const source = ok(await f.call("save", who, save())).result;
    ok(await f.call("start", who, { id: "start-one", ...source }));
    const running = f.call("execute", who, command(source));
    await arrived;
    const suspended = ok(await f.call("suspend", who, 1));
    assert.equal(suspended.closed, false);
    assert.equal(suspended.lease, null);
    assert.deepEqual(suspended.source.files, files());
    hold = false;
    assert.equal(
      ok(
        await f.call(
          "start",
          who,
          { id: "start-two", ...source },
          { execution: executionGrant(2) },
        ),
      ).status,
      "completed",
    );
    release();
    assert.equal(ok(await running).result.code, "workspace_claim_revoked");
    const state = ok(await f.call("inspect", who));
    assert.equal(state.vm.running, true);
    assert.equal(state.state.lease.session, 2);
    assert.equal(
      (await f.call("execute", who, command(source, "late-old"))).status,
      409,
    );
  } finally {
    release();
    await f.close();
  }
});
