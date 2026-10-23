import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, expectStatus, path } from "./helpers.mjs";
import {
  building,
  current,
  guard,
  files,
  rows,
  reconcile,
  status,
  deferred,
} from "./workspace.helpers.mjs";

const options = { timeout: 20000 };
const execute = async (fixture, task, tool, operationId) =>
  fixture.control({
    action: "workspace-tool",
    id: task.id,
    tool,
    operationId,
    guard: guard(await current(fixture, task)),
  });

test(
  "advertised workspace tools persist bounded feedback and meter every read/write/command once",
  options,
  async () => {
    const fixture = await taskFixture({ workspaces: true });
    try {
      const task = await building(fixture);
      const definitions = await fixture.control({ action: "workspace-tools" });
      expectStatus(definitions, 200);
      assert.equal(definitions.body.length, 7);
      const empty = await execute(
        fixture,
        task,
        { kind: "workspace_list" },
        "list-empty",
      );
      expectStatus(empty, 200);
      assert.equal(empty.body.revision, 0);
      const saved = await execute(
        fixture,
        task,
        { kind: "workspace_write", expectedRevision: 0, files: files() },
        "write",
      );
      expectStatus(saved, 200);
      const reference = saved.body.result;
      const listed = await execute(
        fixture,
        task,
        { kind: "workspace_list" },
        "list-source",
      );
      expectStatus(listed, 200);
      assert.equal(listed.body.files.length, 2);
      const read = await execute(
        fixture,
        task,
        {
          kind: "workspace_read",
          revision: 1,
          path: "src/service.mjs",
          offset: 0,
        },
        "read-source",
      );
      expectStatus(read, 200);
      assert.equal(read.body.content, files()[0].content);
      expectStatus(
        await execute(
          fixture,
          task,
          { kind: "workspace_start", ...reference },
          "start",
        ),
        200,
      );
      expectStatus(
        await execute(
          fixture,
          task,
          { kind: "workspace_check", ...reference, path: "src/service.mjs" },
          "check",
        ),
        200,
      );
      const result = await execute(
        fixture,
        task,
        {
          kind: "workspace_test",
          ...reference,
          paths: ["tests/service.test.mjs"],
        },
        "test",
      );
      expectStatus(result, 200);
      const feedback = await execute(
        fixture,
        task,
        { kind: "workspace_result", operationId: "test" },
        "read-result",
      );
      assert.deepEqual(feedback.body, result.body);
      const recorded = await rows(fixture);
      assert.equal(recorded.operations.length, 8);
      assert.ok(recorded.operations.every((row) => row.settled));
      assert.equal(
        recorded.operations[3].receipt.result.content,
        files()[0].content,
      );
      assert.equal((await current(fixture, task)).usage.toolCalls, 8);
      assert.equal((await current(fixture, task)).usage.reservedToolCalls, 0);
      const replay = await execute(
        fixture,
        task,
        { kind: "workspace_list" },
        "list-empty",
      );
      assert.deepEqual(
        replay.body,
        empty.body,
        "Replay preserves the original observation",
      );
      assert.equal((await current(fixture, task)).usage.toolCalls, 8);
      await fixture.restart();
      const restored = await rows(fixture);
      assert.deepEqual(
        restored.operations.map((row) => row.receipt),
        recorded.operations.map((row) => row.receipt),
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "unavailable, foreign and malformed model tools cannot create a task operation",
  options,
  async () => {
    for (const workspaces of [false, true]) {
      const fixture = await taskFixture({ workspaces });
      try {
        const task = await building(fixture);
        const definitions = await fixture.control({
          action: "workspace-tools",
        });
        assert.equal(definitions.body.length, workspaces ? 7 : 0);
        if (!workspaces)
          expectStatus(
            await execute(fixture, task, { kind: "workspace_list" }, "list"),
            409,
          );
        expectStatus(
          await execute(
            fixture,
            task,
            { kind: "workspace_list", ownerId: "someone-else" },
            "injected",
          ),
          409,
        );
        expectStatus(
          await fixture.request("/__test", {
            session: fixture.otherCookie,
            body: {
              action: "workspace-tool",
              id: task.id,
              tool: { kind: "workspace_list" },
              operationId: "foreign",
              guard: guard(task),
            },
          }),
          409,
        );
        assert.equal((await rows(fixture)).operations.length, 0);
        assert.equal((await current(fixture, task)).usage.reservedToolCalls, 0);
      } finally {
        await fixture.close();
      }
    }
  },
);

test(
  "Stop during a delayed source read records uncertainty and settles usage without continuing a tool",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    const fixture = await taskFixture({
      workspaces: true,
      workspaceControl: async (request) => {
        const value = await request.json();
        if (value.action === "lookup" && value.phase === "after") {
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const task = await building(fixture);
      const reading = execute(
        fixture,
        task,
        { kind: "workspace_list" },
        "read",
      );
      await entered.promise;
      const fresh = await current(fixture, task);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: fresh.revision },
        }),
        200,
      );
      expectStatus(await reading, 409);
      const recovered = await reconcile(fixture);
      assert.equal(recovered.operations[0].receipt, null);
      assert.equal(recovered.operations[0].settled, true);
      assert.equal(recovered.links[0].cleaned, true);
      release.resolve();
      const stopped = await current(fixture, task);
      assert.equal(stopped.state, "stopped");
      assert.equal(stopped.usage.toolCalls, 1);
      assert.equal(stopped.usage.reservedToolCalls, 0);
      assert.equal(
        (await status(fixture, recovered.links[0].identity)).stats.vm.starts,
        0,
      );
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);
