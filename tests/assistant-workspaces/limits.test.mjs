import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_LIMITS as limits } from "../../packages/pvo-assistant/workspaces/index.js";
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

test("new saves cannot grow the operation journal past its cap, but exact receipts still replay", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    let first;
    for (let revision = 0; revision < limits.operations; revision++) {
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
          id: "one-too-many",
          expectedRevision: limits.operations,
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
    assert.equal(
      ok(await f.call("inspect", who)).actions.length,
      limits.operations,
    );
  } finally {
    await f.close();
  }
});

test("editing and restoring cannot reset a task's computer session cap", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  try {
    for (let n = 0; n < limits.sessions; n++) {
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
        expectedRevision: limits.sessions,
        files: files(),
      }),
    ).result;
    assert.equal(
      (await f.call("start", who, { id: "too-many", ...source })).status,
      409,
    );
    assert.equal(ok(await f.call("inspect", who)).vm.starts, limits.sessions);
    assert.equal(ok(await f.call("inspect", who)).vm.running, false);
  } finally {
    await f.close();
  }
});
