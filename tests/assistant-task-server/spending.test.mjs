import assert from "node:assert/strict";
import test from "node:test";
import {
  taskSpendingAllowed,
  taskSpendingCapability,
} from "../../server/assistant/tasks/spending.js";
import { taskFixture, saved, path, expectStatus, NOW } from "./helpers.mjs";
import { files, rows, status } from "./workspace.helpers.mjs";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";

const grant = (ownerId, capabilities, expiresAt = NOW + 60000) => ({
  ownerId,
  capabilities,
  expiresAt,
});
const configuration = (grants) => ({
  ASSISTANT_TASK_SPENDING: JSON.stringify(grants),
});

test("cloud spending requires a valid, unexpired trusted owner grant for the actual capability", () => {
  const valid = grant("owner-one", ["model", "workspace"]);
  for (const env of [
    {},
    { ASSISTANT_TASK_SPENDING: "not JSON" },
    configuration({}),
    configuration([{ ...valid, extra: true }]),
    configuration([valid, valid]),
    configuration([{ ...valid, capabilities: ["model", "model"] }]),
    configuration([{ ...valid, capabilities: ["anything"] }]),
  ])
    assert.equal(taskSpendingAllowed(env, "owner-one", "model", NOW), false);
  assert.equal(
    taskSpendingAllowed(configuration([valid]), "owner-one", "model", NOW),
    true,
  );
  assert.equal(
    taskSpendingAllowed(configuration([valid]), "owner-two", "model", NOW),
    false,
  );
  assert.equal(
    taskSpendingAllowed(configuration([valid]), "owner-one", "hosting", NOW),
    false,
  );
  assert.equal(
    taskSpendingAllowed(
      configuration([valid]),
      "owner-one",
      "model",
      valid.expiresAt,
    ),
    false,
  );
  for (const [stepId, stage, capability] of [
    ["plan", null, "model"],
    ["attach", null, "model"],
    ["build", "model", "model"],
    ["build", "tools", "workspace"],
    ["validate", null, "workspace"],
    ["host", null, "hosting"],
  ])
    assert.equal(taskSpendingCapability({ stepId }, stage), capability);
});

test("missing, foreign and expired permission performs no paid work; trusted approval resumes the same saved cursor", async () => {
  let models = 0;
  const fixture = await taskFixture({
    clock: NOW,
    spending: false,
    workspaces: true,
    planner: async (request) => {
      models++;
      const task = await request.json();
      if (task.stepId === "plan")
        return Response.json({ kind: "checkpoint", stepId: "build" });
      const context = task.builderContext;
      if (!context.agreement)
        return Response.json({
          kind: "agreement",
          agreement: dinnerAgreement(),
        });
      const written = context.feedback.find(
        (item) => item.kind === "workspace_write",
      );
      if (!written)
        return Response.json({
          kind: "tools",
          calls: [
            { kind: "workspace_write", expectedRevision: 0, files: files() },
          ],
          review: null,
        });
      if (!context.feedback.some((item) => item.kind === "workspace_start"))
        return Response.json({
          kind: "tools",
          calls: [{ kind: "workspace_start", ...written.result.result }],
          review: null,
        });
      return Response.json({
        kind: "ask",
        prompt: "What is the next requirement?",
        choices: [],
      });
    },
  });
  try {
    const original = await saved(fixture);
    const read = async () => (await fixture.request(path(original))).body.task;
    const sweep = async () => {
      for (let n = 0; n < 6; n++)
        expectStatus(await fixture.control({ action: "sweep" }), 200);
    };
    const approve = async (grants) =>
      expectStatus(
        await fixture.control({ action: "grant-spending", grants }),
        200,
      );
    const resume = async () =>
      expectStatus(
        await fixture.request(path(original) + "/resume", {
          body: { expectedRevision: (await read()).revision },
        }),
        200,
      );
    await sweep();
    const waiting = await read();
    assert.deepEqual(waiting.wait, { reason: "spending_permission" });
    assert.equal(waiting.nextRunAt, null);
    assert.equal(waiting.usage.modelTurns, 0);
    assert.equal(waiting.operations.length, 0);
    assert.equal(models, 0);
    await fixture.restart();
    assert.deepEqual(await read(), waiting);
    await resume();
    await sweep();
    assert.equal(models, 0, "Resume never grants permission");
    await approve([grant("some-other-owner", ["model", "workspace"])]);
    await resume();
    await sweep();
    assert.equal(
      models,
      0,
      "Another account's grant cannot authorize this task",
    );
    await approve([grant(original.ownerId, ["model"])]);
    await resume();
    await sweep();
    assert.equal(models, 3);
    const beforeTools = await read();
    assert.equal(beforeTools.state, "waiting");
    assert.equal(beforeTools.stepId, "build");
    assert.equal(
      (await rows(fixture)).operations.length,
      0,
      "Workspace work requires its own capability",
    );
    const builder = (
      await fixture.control({ action: "builder-state", id: original.id })
    ).body;
    assert.equal(builder.cursor, 0);
    await fixture.control({ action: "time", now: NOW + 60000 });
    await approve([
      grant(original.ownerId, ["model", "workspace"], NOW + 60000),
    ]);
    await resume();
    await sweep();
    assert.equal(models, 3);
    assert.equal(
      (await rows(fixture)).operations.length,
      0,
      "Expiry does not reset paid permission",
    );
    await approve([
      grant(original.ownerId, ["model", "workspace"], NOW + 86400000),
    ]);
    await fixture.restart();
    await fixture.control({ action: "time", now: NOW + 60000 });
    await resume();
    await sweep();
    const finished = await read();
    assert.equal(finished.id, original.id);
    assert.equal(finished.state, "waiting_for_answer");
    assert.deepEqual(finished.input, original.input);
    const work = await rows(fixture);
    assert.equal(
      work.operations.filter((row) => row.kind === "save").length,
      1,
    );
    const start = work.operations.find((row) => row.kind === "start");
    assert.equal((await status(fixture, start.identity)).stats.vm.starts, 1);
    expectStatus(
      await fixture.request(path(original) + "/stop", {
        body: { expectedRevision: finished.revision },
      }),
      200,
    );
    const calls = models;
    await approve([
      grant(
        original.ownerId,
        ["model", "workspace", "hosting"],
        NOW + 86400000,
      ),
    ]);
    await sweep();
    assert.equal((await read()).state, "stopped");
    assert.equal(models, calls, "Later approval cannot restart a stopped goal");
  } finally {
    await fixture.close();
  }
});
