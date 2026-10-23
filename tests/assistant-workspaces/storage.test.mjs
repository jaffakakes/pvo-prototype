import assert from "node:assert/strict";
import test from "node:test";
import { contentDigest } from "../../server/contentDigest.js";
import { serializeServiceFiles } from "../../packages/pvo-assistant/services/index.js";
import { identity, NOW, files, command, workspaceFixture } from "./helpers.mjs";

const ok = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.result;
};
async function save(
  fixture,
  who,
  id = "save-one",
  expectedRevision = 0,
  source = files(),
) {
  return ok(
    await fixture.call("save", who, { id, expectedRevision, files: source }),
  ).result;
}

test("owned source and immutable receipts survive full workerd restart with compare-and-swap edits", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    const input = { id: "save-one", expectedRevision: 0, files: files() };
    const first = ok(await f.call("save", who, input));
    assert.equal(
      first.result.digest,
      await contentDigest(serializeServiceFiles(files())),
    );
    await f.restart();
    assert.deepEqual(ok(await f.call("save", who, input)), first);
    assert.deepEqual(ok(await f.call("lookup", who)).source.files, files());
    assert.equal(
      (await f.call("save", who, { ...input, files: [] })).status,
      409,
    );
    assert.equal(
      (await f.call("save", who, { ...input, id: "save-two" })).status,
      409,
    );
    assert.equal(
      (await f.call("lookup", { ...who, ownerId: "other" })).status,
      409,
    );
    assert.equal(
      (await f.call("lookup", { ...who, taskId: "foreign-task" })).status,
      409,
    );
    assert.equal(
      ok(await f.call("lookup", await identity("task-two"))).source,
      null,
    );
    const results = await Promise.all([
      f.call("save", who, { ...input, id: "edit-a", expectedRevision: 1 }),
      f.call("save", who, { ...input, id: "edit-b", expectedRevision: 1 }),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  } finally {
    await f.close();
  }
});

test("workspace restoration uses saved files and interruption never reruns the old command", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    const source = await save(f, who);
    const first = ok(
      await f.call("start", who, { id: "start-one", ...source }),
    );
    assert.equal(first.status, "completed");
    assert.deepEqual(ok(await f.call("inspect", who)).vm.files, files());
    assert.equal(
      ok(await f.call("execute", who, command(source))).result.exitCode,
      0,
    );
    const reordered = command(source);
    reordered.command = { paths: reordered.command.paths, kind: "test" };
    assert.equal(
      ok(await f.call("execute", who, reordered)).result.exitCode,
      0,
    );
    assert.equal(ok(await f.call("inspect", who)).vm.executions, 1);
    await f.restart();
    const recovered = ok(await f.call("lookup", who));
    assert.equal(recovered.lease, null);
    assert.deepEqual(recovered.source.files, files());
    assert.deepEqual(
      ok(await f.call("start", who, { id: "start-one", ...source })),
      first,
    );
    assert.equal(ok(await f.call("inspect", who)).vm.starts, 1);
    assert.equal(
      ok(await f.call("start", who, { id: "start-two", ...source })).status,
      "completed",
    );
    const updated = await save(f, who, "save-two", 1, [
      { ...files()[0], content: "export const execute=()=>43;" },
    ]);
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
    assert.equal(
      (await f.call("start", who, { id: "stale", ...source })).status,
      409,
    );
    assert.equal(
      ok(await f.call("start", who, { id: "start-three", ...updated })).status,
      "completed",
    );
    assert.equal(
      ok(await f.call("inspect", who)).vm.files[0].content,
      "export const execute=()=>43;",
    );
  } finally {
    await f.close();
  }
});

test("Stop creates a tombstone before initialization and preserves existing source through retention", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    const empty = await identity("stopped-early");
    assert.equal(ok(await f.call("stop", empty)).closed, true);
    assert.equal(
      (
        await f.call("save", empty, {
          id: "late",
          expectedRevision: 0,
          files: files(),
        })
      ).status,
      409,
    );
    const source = await save(f, who);
    ok(await f.call("start", who, { id: "start", ...source }));
    assert.deepEqual(ok(await f.call("stop", who)).source.files, files());
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
    await f.restart();
    assert.equal(
      (await f.call("start", who, { id: "late", ...source })).status,
      409,
    );
    ok(
      await f.call("time", who, null, {
        now: ok(await f.call("inspect", who)).state.contentExpiresAt,
      }),
    );
    assert.equal(ok(await f.call("lookup", who)).source, null);
    assert.equal(ok(await f.call("inspect", who)).actions.length, 0);
    assert.equal(
      (
        await f.call("save", who, {
          id: "save-one",
          expectedRevision: 0,
          files: files(),
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("Stop during command execution rejects the late result and releases the whole owned workspace", async () => {
  let arrive;
  const arrived = new Promise((resolve) => (arrive = resolve));
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  const f = await workspaceFixture(async (request) => {
    const { kind } = await request.json();
    if (kind === "execute") {
      arrive();
      await blocked;
    }
    return Response.json({ stdout: "late" });
  });
  const who = await identity();
  try {
    const source = await save(f, who);
    ok(await f.call("start", who, { id: "start", ...source }));
    const running = f.call("execute", who, command(source));
    await arrived;
    assert.equal(
      (await f.call("execute", who, command(source, "second"))).status,
      409,
    );
    assert.equal(ok(await f.call("stop", who)).closed, true);
    release();
    const receipt = ok(await running);
    assert.equal(receipt.status, "interrupted");
    assert.equal(receipt.result.code, "workspace_stopped");
    const state = ok(await f.call("inspect", who));
    assert.equal(state.vm.running, false);
    assert.equal(state.vm.executions, 1);
    assert.equal(
      ok(await f.call("inspect", who, null, { budget: true }))[0].released,
      true,
    );
  } finally {
    release();
    await f.close();
  }
});

test("cleanup failure retains capacity and source, retries with backoff, then stops retrying", async () => {
  let fail = false;
  const f = await workspaceFixture(async (request) =>
    Response.json({ fail: fail && (await request.json()).kind === "destroy" }),
  );
  const who = await identity();
  try {
    const source = await save(f, who);
    ok(await f.call("start", who, { id: "start", ...source }));
    fail = true;
    assert.equal(ok(await f.call("stop", who)).cleanupRequired, true);
    for (let i = 0; i < 5; i++) {
      const state = ok(await f.call("inspect", who)).state;
      if (state.nextCleanupAt !== null) {
        ok(await f.call("time", who, null, { now: state.nextCleanupAt }));
        ok(await f.call("alarm", who));
      }
    }
    const exhausted = ok(await f.call("inspect", who)).state;
    assert.equal(exhausted.cleanupAttempts, 5);
    assert.equal(exhausted.nextCleanupAt, null);
    assert.equal(exhausted.lease.sourceRevision, 1);
    assert.equal(
      ok(await f.call("inspect", who, null, { budget: true }))[0].released,
      false,
    );
    ok(
      await f.call("time", who, null, {
        now: ok(await f.call("inspect", who)).state.contentExpiresAt,
      }),
    );
    ok(await f.call("alarm", who));
    const expired = ok(await f.call("lookup", who));
    assert.equal(expired.source, null);
    assert.equal(expired.cleanupRequired, true);
    assert.notEqual(expired.lease, null);
    fail = false;
    assert.equal(ok(await f.call("reconcile", who)).cleanupRequired, false);
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
    assert.equal(
      ok(await f.call("inspect", who, null, { budget: true }))[0].released,
      true,
    );
  } finally {
    await f.close();
  }
});
