import assert from "node:assert/strict";
import test from "node:test";
import { prepareWorkspaceIdentity } from "../../server/assistant/workspaces/identity.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";
import { identity, files, workspaceFixture } from "./helpers.mjs";

const ok = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.result;
};

test("workspace identity is derived from the saved task and survives execution-generation changes", async () => {
  const task = create();
  const before = await prepareWorkspaceIdentity(task);
  assert.deepEqual(await prepareWorkspaceIdentity(claim(task)), before);
  assert.notEqual(
    (await prepareWorkspaceIdentity({ ...task, ownerId: "owner-other" }))
      .resourceId,
    before.resourceId,
  );
  assert.notEqual(
    (await prepareWorkspaceIdentity({ ...task, id: "task-other" })).resourceId,
    before.resourceId,
  );
  await assert.rejects(
    prepareWorkspaceIdentity({ ...task, ownerId: undefined }),
  );
});

test("100 source revisions survive restart and keep exact replay without a goal-wide cutoff", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    let first;
    for (let revision = 0; revision < 100; revision++) {
      const receipt = ok(
        await f.call("save", who, {
          id: `save-${revision}`,
          expectedRevision: revision,
          files: files(),
        }),
      );
      first ??= receipt;
    }
    assert.equal(
      (
        await f.call("save", who, {
          id: "save-0",
          expectedRevision: 100,
          files: files(),
        })
      ).status,
      409,
    );
    assert.deepEqual(
      ok(
        await f.call("save", who, {
          id: "save-0",
          expectedRevision: 0,
          files: files(),
        }),
      ),
      first,
    );
    const before = ok(await f.call("inspect", who));
    assert.equal(before.actions.length, 100);
    const source = ok(await f.call("lookup", who)).source;
    assert.equal(source.revision, 100);
    await f.restart();
    assert.deepEqual(ok(await f.call("lookup", who)).source, source);
    assert.deepEqual(
      ok(
        await f.call("save", who, {
          id: "save-0",
          expectedRevision: 0,
          files: files(),
        }),
      ),
      first,
    );
  } finally {
    await f.close();
  }
});

test("successive workers continue beyond the former four-session cutoff", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    for (let n = 0; n < 8; n++) {
      const source = ok(
        await f.call("save", who, {
          id: `save-${n}`,
          expectedRevision: n,
          files: files(),
        }),
      ).result;
      assert.equal(
        ok(await f.call("start", who, { id: `start-${n}`, ...source })).status,
        "completed",
      );
    }
    const source = ok(
      await f.call("save", who, {
        id: "final-save",
        expectedRevision: 8,
        files: files(),
      }),
    ).result;
    assert.equal(
      ok(await f.call("start", who, { id: "next-session", ...source })).status,
      "completed",
    );
    assert.equal(ok(await f.call("inspect", who)).vm.starts, 9);
    assert.equal(ok(await f.call("inspect", who)).vm.running, true);
  } finally {
    await f.close();
  }
});
