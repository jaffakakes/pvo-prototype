import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, expectStatus, NOW, path } from "./helpers.mjs";
import { files, rows, status } from "./workspace.helpers.mjs";
import { identity } from "../assistant-workspaces/helpers.mjs";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
import { WORKSPACE_LIMITS } from "../../packages/pvo-assistant/workspaces/index.js";

for (const capacity of ["concurrent", "daily"]) {
  test(`a ${capacity} workspace denial preserves source and resumes with a new attempt after restart`, async () => {
    let models = 0,
      commands = 0;
    const fixture = await taskFixture({
      clock: NOW,
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
        const saved = context.feedback.find(
          (item) => item.kind === "workspace_write",
        );
        if (!saved)
          return Response.json({
            kind: "tools",
            calls: [
              { kind: "workspace_write", expectedRevision: 0, files: files() },
            ],
            review: null,
          });
        if (
          context.feedback.some(
            (item) =>
              item.kind === "workspace_test" &&
              item.result.status === "completed",
          )
        ) {
          if (
            !context.feedback.some((item) => item.kind === "workspace_result")
          ) {
            const denied = context.feedback.find(
              (item) =>
                item.kind === "workspace_start" &&
                item.result.status === "interrupted",
            );
            return Response.json({
              kind: "tools",
              calls: [
                { kind: "workspace_result", operationId: denied.operationId },
              ],
              review: null,
            });
          }
          return Response.json({
            kind: "ask",
            prompt: "Ready for the next requirement?",
            choices: [],
          });
        }
        return Response.json({
          kind: "tools",
          calls: [
            { kind: "workspace_start", ...saved.result.result },
            {
              kind: "workspace_test",
              ...saved.result.result,
              paths: ["tests/service.test.mjs"],
            },
          ],
          review: null,
        });
      },
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "execute") commands++;
        return Response.json({ exitCode: 0, stdout: "checked" });
      },
    });
    const budget = async (method, lease, now = NOW) => {
      const response = await fixture.control({
        action: "workspace-budget",
        method,
        lease,
        now,
      });
      expectStatus(response, 200);
      return response.body;
    };
    const sweep = async (count) => {
      for (let index = 0; index < count; index++)
        expectStatus(await fixture.control({ action: "sweep" }), 200);
    };
    try {
      const held = [];
      const total =
        capacity === "daily"
          ? WORKSPACE_LIMITS.dailySessions
          : WORKSPACE_LIMITS.concurrent;
      for (let index = 0; index < total; index++) {
        const who = await identity(`occupied-${index}`);
        const lease = {
          id: `${who.resourceId}-1`,
          resourceId: who.resourceId,
          session: 1,
          sourceRevision: 1,
          startedAt: NOW,
          deadlineAt: NOW + WORKSPACE_LIMITS.sessionMs,
          expiresAt: NOW + 86400000,
        };
        assert.equal((await budget("reserve", lease)).accepted, true);
        if (capacity === "daily") await budget("release", lease);
        else held.push(lease);
      }
      const original = await saved(fixture);
      await sweep(8);
      const read = async () =>
        (await fixture.request(path(original))).body.task;
      const waiting = await read();
      const reason =
        capacity === "daily" ? "workspace_allowance" : "workspace_capacity";
      const retryAt = NOW + (capacity === "daily" ? 86400000 : 30000);
      assert.equal(waiting.state, "waiting");
      assert.deepEqual(waiting.wait, { reason });
      assert.equal(waiting.nextRunAt, retryAt);
      assert.equal(waiting.usage.reservedToolCalls, 0);
      assert.equal(
        commands,
        0,
        "Dependent test did not run after denied start",
      );
      const before = await rows(fixture);
      const denied = before.operations.find((row) => row.kind === "start");
      assert.equal(denied.receipt.result.code, reason);
      const computer = await status(fixture, denied.identity);
      assert.equal(computer.stats.vm.starts, 0);
      assert.deepEqual(computer.observation.source.files, files());
      const count = models;
      await fixture.restart();
      assert.deepEqual(await read(), waiting);
      await sweep(2);
      assert.equal(models, count);
      for (const lease of held) await budget("release", lease);
      await fixture.control({ action: "time", now: retryAt });
      await sweep(8);
      const resumed = await read();
      assert.equal(resumed.id, original.id);
      assert.equal(resumed.state, "waiting_for_answer");
      assert.equal(resumed.wait, null);
      assert.equal(commands, 1);
      const after = await rows(fixture);
      const starts = after.operations.filter((row) => row.kind === "start");
      assert.equal(starts.length, 2);
      assert.deepEqual(
        starts.find((row) => row.operationId === denied.operationId).receipt,
        denied.receipt,
      );
      assert.ok(starts.some((row) => row.receipt.status === "completed"));
      const final = await status(fixture, denied.identity);
      assert.equal(final.stats.vm.starts, 1);
      assert.equal(final.observation.source.revision, 1);
      assert.deepEqual(final.observation.source.files, files());
    } finally {
      await fixture.close();
    }
  });
}
