import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  taskFixture,
  saved,
  path,
  current,
  until,
  planner,
  validation,
  deferred,
  expectStatus,
} from "./task.helpers.mjs";
const options = { timeout: 25000 };

test(
  "trusted task validation repairs actual behavior against the frozen agreement and saves the exact passing package",
  options,
  async () => {
    const calls = [];
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner({
        repair: true,
        cases: 2,
        observe: (task) => calls.push(task),
      }),
    });
    try {
      const task = await saved(f);
      const end = await until(
        () => current(f, task),
        (value) => value.state === "failed",
      );
      assert.equal(end.stepId, "attach", JSON.stringify(end));
      assert.equal(
        end.failure.code,
        "provider_unavailable",
        "Attachment is a separate unfinished step",
      );
      assert.equal(end.result, null);
      assert.equal(end.usage.modelTurns, 6);
      assert.equal(end.usage.toolCalls, 8); // two writes, two captures, three cases (first fails)
      assert.equal(end.usage.reservedToolCalls, 0);
      const stored = await validation(f, task);
      assert.equal(stored.artifacts.length, 2);
      const [failed, passed] = stored.artifacts;
      assert.equal(failed.report.status, "failed");
      assert.equal(failed.report.cases[0].failure.code, "mismatch");
      assert.equal(passed.report.status, "passed");
      assert.equal(passed.report.cases.length, 2);
      const captured = end.operations.filter((operation) => operation.artifact);
      assert.equal(captured.length, 2);
      assert.equal(
        captured.at(-1).artifact.sha256,
        passed.artifact.identity.packageDigest,
      );
      assert.deepEqual(captured.at(-1).resources, [
        { kind: "artifact", id: captured.at(-1).artifact.id },
      ]);
      assert.notEqual(
        passed.artifact.identity.packageDigest,
        failed.artifact.identity.packageDigest,
      );
      assert.equal(
        passed.artifact.identity.agreementDigest,
        failed.artifact.identity.agreementDigest,
      );
      assert.equal(
        calls[4].builderContext.reviewFeedback.report.status,
        "failed",
      );
      assert.deepEqual(
        calls[4].builderContext.agreement,
        calls[2].builderContext.agreement,
      );
      assert.ok(stored.attempts.every((row) => row.settled));
      const other = await f.request("/__test", {
        session: f.otherCookie,
        body: { action: "validation-state", id: task.id },
      });
      assert.deepEqual(other.body, { attempts: [], artifacts: [] });
      await f.restart();
      assert.deepEqual(await validation(f, task), stored);
      await f.control({ action: "time", now: task.expiresAt + 1 });
      await f.control({ action: "sweep" });
      assert.deepEqual(await validation(f, task), {
        attempts: [],
        artifacts: [],
      });
    } finally {
      await f.close();
    }
  },
);

test(
  "restart keeps completed cases and retries only the lost isolated case with a new charged attempt",
  options,
  async () => {
    const entered = deferred();
    const executions = [];
    let held = false;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner({ cases: 2 }),
      validationControl: async (request) => {
        const value = await request.json();
        if (value.phase === "before") executions.push(value.index);
        if (value.index === 1 && value.phase === "after" && !held) {
          held = true;
          entered.resolve();
          await delay(2500);
        }
        return Response.json({});
      },
    });
    try {
      const task = await saved(f);
      await entered.promise;
      const before = await validation(f, task);
      assert.equal(before.artifacts[0].report.cases.length, 1);
      assert.equal(before.artifacts[0].report.status, "running");
      await f.restart();
      const end = await until(
        () => current(f, task),
        (value) => value.state === "failed",
      );
      assert.equal(end.stepId, "attach", JSON.stringify(end));
      const after = await validation(f, task);
      assert.deepEqual(executions, [0, 1, 1]);
      assert.equal(end.retries, 1);
      assert.equal(end.usage.toolCalls, 6);
      assert.equal(end.usage.reservedToolCalls, 0);
      assert.equal(after.artifacts[0].report.status, "passed");
      assert.equal(
        after.attempts.filter((row) => row.status === "interrupted").length,
        1,
      );
      assert.equal(
        new Set(after.attempts.map((row) => row.operationId)).size,
        4,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Stop during validation blocks a late pass and preserves only the previously committed case prefix",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner({ cases: 2 }),
      validationControl: async (request) => {
        const value = await request.json();
        if (value.index === 1 && value.phase === "after") {
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const task = await saved(f);
      await entered.promise;
      const running = await current(f, task);
      expectStatus(
        await f.request(path(task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      const stopped = await until(
        () => current(f, task),
        (value) =>
          value.state === "stopped" && value.usage.reservedToolCalls === 0,
      );
      const stored = await validation(f, task);
      assert.equal(stopped.result, null);
      assert.equal(stored.artifacts[0].report.status, "running");
      assert.equal(stored.artifacts[0].report.cases.length, 1);
      await f.restart();
      assert.equal((await current(f, task)).state, "stopped");
      assert.deepEqual(await validation(f, task), stored);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "an incorrect source identifier returns bounded repair feedback and never creates an approved artifact",
  options,
  async () => {
    const generate = planner();
    let reviews = 0;
    const contexts = [];
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: async (request) => {
        const value = await request.clone().json();
        contexts.push(value.builderContext);
        const decision = await (await generate(request)).json();
        if (decision.kind === "review" && reviews++ === 0)
          decision.digest = "0".repeat(64);
        return Response.json(decision);
      },
    });
    try {
      const task = await saved(f);
      const end = await until(
        () => current(f, task),
        (value) => value.state === "failed",
      );
      assert.equal(end.stepId, "attach", JSON.stringify(end));
      const stored = await validation(f, task);
      assert.equal(stored.artifacts.length, 1);
      assert.equal(stored.artifacts[0].report.status, "passed");
      assert.equal(stored.attempts[0].status, "failed");
      assert.equal(contexts.at(-1).reviewFeedback.report, null);
      assert.match(contexts.at(-1).reviewFeedback.error, /exact saved source/);
    } finally {
      await f.close();
    }
  },
);

test(
  "Stop during source capture prevents the late saved bundle from advancing the task",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    let held = false;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: planner(),
      workspaceControl: async (request) => {
        const value = await request.json();
        if (value.phase === "after" && value.action === "lookup" && !held) {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const task = await saved(f);
      await entered.promise;
      const running = await current(f, task);
      assert.equal(running.stepId, "validate");
      expectStatus(
        await f.request(path(task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      await until(
        () => current(f, task),
        (value) =>
          value.state === "stopped" && value.usage.reservedToolCalls === 0,
      );
      const state = await validation(f, task);
      assert.equal(state.artifacts.length, 0);
      assert.equal(state.attempts[0].settled, true);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "validation enforces the existing tool budget even when saved cases remain unfinished",
  options,
  async () => {
    const basic = planner({ cases: 16 });
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: async (request) => {
        const task = await request.clone().json();
        const decision = await (await basic(request)).json();
        if (decision.kind === "tools")
          decision.calls.push(
            ...Array.from({ length: 3 }, () => ({ kind: "workspace_list" })),
          );
        if (decision.kind === "review")
          return Response.json({
            kind: "tools",
            calls: Array.from({ length: 4 }, () => ({
              kind: "workspace_list",
            })),
            review: task.builderContext.round === 4 ? decision : null,
          });
        return Response.json(decision);
      },
    });
    try {
      const task = await saved(f);
      const end = await until(
        () => current(f, task),
        (value) => value.state === "failed",
      );
      assert.equal(end.stepId, "validate", JSON.stringify(end));
      assert.equal(end.failure.code, "budget_exceeded");
      assert.equal(end.usage.toolCalls, 24);
      assert.equal(end.usage.modelTurns, 6);
      assert.equal(end.usage.reservedToolCalls, 0);
      const state = await validation(f, task);
      assert.equal(state.artifacts[0].report.status, "running");
      assert.equal(state.artifacts[0].report.cases.length, 7);
      assert.equal(end.result, null);
    } finally {
      await f.close();
    }
  },
);
