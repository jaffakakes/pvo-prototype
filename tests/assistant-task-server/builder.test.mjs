import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { taskFixture, saved, path, expectStatus } from "./helpers.mjs";
import {
  current,
  files,
  rows,
  status,
  deferred,
} from "./workspace.helpers.mjs";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
const options = { timeout: 25000 };
const agreement = () => ({ kind: "agreement", agreement: dinnerAgreement() });
const batch = (calls, review = null) => ({ kind: "tools", calls, review });
const review = (reference) => ({
  kind: "review",
  ...reference,
  entrypoint: "src/service.mjs",
  tests: ["tests/service.test.mjs"],
});
const state = async (fixture, task) =>
  (await fixture.control({ action: "builder-state", id: task.id })).body;
async function until(read, predicate) {
  const deadline = Date.now() + 12000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  assert.fail("Builder did not reach expected state: " + JSON.stringify(value));
}
function source(context) {
  return context.feedback
    .filter((item) => item.kind === "workspace_write")
    .at(-1).result.result;
}
function base(task) {
  if (task.stepId === "plan") return { kind: "checkpoint", stepId: "build" };
  if (!task.builderContext.agreement) return agreement();
  if (!task.builderContext.feedback.length)
    return batch([
      { kind: "workspace_write", expectedRevision: 0, files: files() },
    ]);
  return null;
}

test(
  "durable builder saves agreement, observes failed tests and repairs within six model turns",
  options,
  async () => {
    const calls = [];
    let executions = 0;
    const fixture = await taskFixture({
      workspaces: true,
      workspaceEffects: async (request) => {
        const value = await request.json();
        if (value.kind === "execute") {
          executions++;
          return Response.json({
            exitCode: executions === 1 ? 1 : 0,
            stdout:
              executions === 1
                ? "Expected capacity rejection, got accepted"
                : "tests passed",
          });
        }
        return Response.json({});
      },
      planner: async (request) => {
        const task = await request.json();
        calls.push(task);
        const first = base(task);
        if (first) return Response.json(first);
        const context = task.builderContext;
        if (context.batchEnd === "failed") {
          assert.ok(
            JSON.stringify(context.feedback).includes(
              "Expected capacity rejection",
            ),
          );
          return Response.json(
            batch([
              {
                kind: "workspace_write",
                expectedRevision: 1,
                files: files().map((file) => ({
                  ...file,
                  content: file.content + "\n// repaired from failure",
                })),
              },
            ]),
          );
        }
        const reference = source(context);
        return Response.json(
          batch(
            [
              { kind: "workspace_start", ...reference },
              {
                kind: "workspace_test",
                ...reference,
                paths: ["tests/service.test.mjs"],
              },
            ],
            review(reference),
          ),
        );
      },
    });
    try {
      const task = await saved(fixture);
      const result = await until(
        () => current(fixture, task),
        (value) => value.state === "failed",
      );
      assert.equal(result.stepId, "validate");
      assert.equal(
        result.failure.code,
        "provider_unavailable",
        "Trusted validation is the next unimplemented stage",
      );
      assert.equal(result.usage.modelTurns, 6);
      assert.equal(result.usage.toolCalls, 6);
      assert.equal(result.usage.reservedToolCalls, 0);
      assert.equal(calls.length, 6);
      assert.equal(executions, 2);
      assert.equal(
        calls[2].builderContext.agreement.body.description,
        dinnerAgreement().description,
      );
      assert.match(calls[2].builderContext.agreement.digest, /^[a-f0-9]{64}$/);
      const before = await state(fixture, task);
      assert.equal(before.batchEnd, "completed");
      assert.equal(before.feedback.length, 6);
      assert.equal(before.feedback[2].result.result.exitCode, 1);
      assert.equal(result.result, null);
      await fixture.restart();
      assert.deepEqual(await state(fixture, task), before);
      const workspace = await rows(fixture);
      await fixture.control({ action: "workspace-reconcile" });
      const actual = await status(fixture, workspace.links[0].identity);
      assert.equal(actual.stats.vm.starts, 2);
      assert.equal(actual.stats.vm.running, false);
      assert.equal(actual.observation.source.revision, 2);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "a restarted builder recovers the exact command receipt and abandons remaining old-computer calls",
  options,
  async () => {
    const entered = deferred();
    let dropped = false,
      executed = 0;
    const calls = [];
    const fixture = await taskFixture({
      workspaces: true,
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "execute") executed++;
        return Response.json({ stdout: "saved before reply was lost" });
      },
      workspaceControl: async (request) => {
        const value = await request.json();
        if (
          value.phase === "after" &&
          value.action === "operate" &&
          value.request?.command &&
          !dropped
        ) {
          dropped = true;
          entered.resolve();
          await delay(2200);
        }
        return Response.json({});
      },
      planner: async (request) => {
        const task = await request.json();
        calls.push(task);
        const first = base(task);
        if (first) return Response.json(first);
        const context = task.builderContext;
        if (context.batchEnd === "interrupted") {
          assert.ok(
            JSON.stringify(context.feedback).includes(
              "saved before reply was lost",
            ),
          );
          return Response.json({
            kind: "ask",
            prompt: "Continue from the recovered test result?",
            choices: ["Continue"],
          });
        }
        const reference = source(context);
        return Response.json(
          batch([
            { kind: "workspace_start", ...reference },
            {
              kind: "workspace_test",
              ...reference,
              paths: ["tests/service.test.mjs"],
            },
            { kind: "workspace_check", ...reference, path: "src/service.mjs" },
          ]),
        );
      },
    });
    try {
      const task = await saved(fixture);
      await entered.promise;
      await fixture.restart();
      const result = await until(
        () => current(fixture, task),
        (value) => value.state === "waiting_for_answer",
      );
      assert.equal(
        executed,
        1,
        "No replay and no dependent call against the dead computer",
      );
      assert.equal(result.usage.toolCalls, 3);
      assert.equal(result.usage.reservedToolCalls, 0);
      assert.equal(result.usage.modelTurns, 5);
      assert.equal(result.retries, 1);
      const restored = await state(fixture, task);
      assert.equal(restored.feedback.length, 3);
      assert.equal(
        restored.feedback.at(-1).result.result.stdout,
        "saved before reply was lost",
      );
      assert.equal(calls.at(-1).builderContext.batchEnd, "interrupted");
    } finally {
      await fixture.close();
    }
  },
);

test(
  "Stop rejects a late builder agreement and leaves no source or computer",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    const fixture = await taskFixture({
      workspaces: true,
      planner: async (request) => {
        const task = await request.json();
        if (task.stepId === "plan")
          return Response.json({ kind: "checkpoint", stepId: "build" });
        entered.resolve();
        await release.promise;
        return Response.json(agreement());
      },
    });
    try {
      const task = await saved(fixture);
      await entered.promise;
      const running = await current(fixture, task);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      const stopped = await until(
        () => current(fixture, task),
        (value) =>
          value.state === "stopped" && value.usage.reservedModelTurns === 0,
      );
      assert.equal(stopped.usage.modelTurns, 2);
      assert.equal((await state(fixture, task)).agreement, null);
      assert.equal((await rows(fixture)).operations.length, 0);
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);

test(
  "Stop during a builder test blocks remaining calls and keeps the immutable agreement",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    let executed = 0;
    const fixture = await taskFixture({
      workspaces: true,
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "execute") {
          executed++;
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
      planner: async (request) => {
        const task = await request.json();
        const first = base(task);
        if (first) return Response.json(first);
        const reference = source(task.builderContext);
        return Response.json(
          batch(
            [
              { kind: "workspace_start", ...reference },
              {
                kind: "workspace_test",
                ...reference,
                paths: ["tests/service.test.mjs"],
              },
              {
                kind: "workspace_check",
                ...reference,
                path: "src/service.mjs",
              },
            ],
            review(reference),
          ),
        );
      },
    });
    try {
      const task = await saved(fixture);
      await entered.promise;
      const running = await current(fixture, task);
      expectStatus(
        await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      await until(
        () => current(fixture, task),
        (value) =>
          value.state === "stopped" && value.usage.reservedToolCalls === 0,
      );
      const builder = await state(fixture, task);
      assert.deepEqual(builder.agreement.body, dinnerAgreement());
      assert.equal(
        builder.feedback.length,
        2,
        "Late command output cannot advance the saved batch",
      );
      assert.equal(executed, 1);
      await fixture.restart();
      assert.equal((await current(fixture, task)).state, "stopped");
      assert.deepEqual(await state(fixture, task), builder);
      const owned = await rows(fixture);
      assert.equal(
        (await status(fixture, owned.links[0].identity)).stats.vm.running,
        false,
      );
      await fixture.control({
        action: "time",
        now: (await fixture.request(path(task))).body.task.expiresAt + 1,
      });
      await fixture.control({ action: "sweep" });
      assert.equal(
        (await state(fixture, task)).agreement,
        null,
        "Private builder source/context expires with its task",
      );
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);
