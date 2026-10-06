import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, expectStatus, path, NOW } from "./helpers.mjs";
import {
  building,
  operate,
  current,
  guard,
  files,
  command,
  rows,
  reconcile,
  status,
  prepare,
} from "./workspace.helpers.mjs";

const options = { timeout: 20000 };
test(
  "saved tasks own stable workspace files, command receipts and exactly-once usage",
  options,
  async () => {
    const fixture = await taskFixture({ workspaces: true });
    try {
      const task = await building(fixture);
      const { reference, identity } = await prepare(fixture, task, files());
      const run = command(reference);
      const result = await operate(fixture, task, "command", run);
      expectStatus(result, 200);
      assert.deepEqual(result.body.receipt.result, {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      });
      const first = await current(fixture, task);
      assert.equal(first.usage.toolCalls, 3);
      assert.equal(first.usage.reservedToolCalls, 0);
      assert.equal(first.operations.length, 3);
      const repeats = await Promise.all(
        Array.from({ length: 4 }, () =>
          fixture.control({
            action: "workspace",
            id: task.id,
            kind: "command",
            request: run,
            guard: guard(first),
          }),
        ),
      );
      assert.ok(repeats.every((result) => result.status === 200));
      assert.equal((await current(fixture, task)).usage.toolCalls, 3);
      assert.equal((await status(fixture, identity)).stats.vm.executions, 1);
      expectStatus(
        await operate(fixture, task, "command", {
          ...run,
          command: { kind: "check", paths: ["src/service.mjs"] },
        }),
        409,
      );
      expectStatus(
        await fixture.request("/__test", {
          session: fixture.otherCookie,
          body: {
            action: "workspace",
            id: task.id,
            kind: "start",
            request: { id: "foreign", ...reference },
            guard: guard(first),
          },
        }),
        409,
      );
      expectStatus(
        await fixture.control({
          action: "workspace",
          id: task.id,
          kind: "start",
          request: { id: "stale", ...reference },
          guard: guard(task),
        }),
        409,
      );
      assert.equal((await rows(fixture)).operations.length, 3);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "a lost command reply is reconciled from its saved receipt without executing it again",
  options,
  async () => {
    const fixture = await taskFixture({
      workspaces: true,
      workspaceControl: async (request) => {
        const value = await request.json();
        return Response.json({
          fail:
            value.phase === "after" &&
            value.action === "operate" &&
            value.request?.id === "test-one",
        });
      },
    });
    try {
      const task = await building(fixture);
      const { reference, identity } = await prepare(fixture, task, files());
      const result = await operate(
        fixture,
        task,
        "command",
        command(reference),
      );
      expectStatus(result, 200);
      assert.equal(result.body.settled, false);
      const failed = await current(fixture, task);
      assert.equal(failed.state, "failed");
      assert.equal(failed.failure.code, "reconciliation_required");
      expectStatus(
        await fixture.request(path(task) + "/resume", {
          body: { expectedRevision: failed.revision },
        }),
        409,
      );
      const recovered = await reconcile(fixture);
      assert.equal(recovered.operations[2].receipt.status, "completed");
      assert.equal(recovered.links[0].cleaned, true);
      const observed = await status(fixture, identity);
      assert.equal(observed.stats.vm.executions, 1);
      assert.equal(observed.stats.vm.running, false);
      assert.deepEqual(observed.observation.source.files, files());
      const settled = await current(fixture, task);
      assert.equal(settled.usage.toolCalls, 3);
      assert.equal(settled.usage.reservedToolCalls, 0);
      await reconcile(fixture);
      assert.equal((await current(fixture, task)).usage.toolCalls, 3);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "a new claim restores the same owned source after the old claim is revoked",
  options,
  async () => {
    const fixture = await taskFixture({ workspaces: true });
    try {
      const task = await building(fixture);
      const { reference, identity } = await prepare(fixture, task, files());
      await fixture.control({ action: "time", now: NOW + 60000 });
      await reconcile(fixture);
      expectStatus(
        await fixture.control({
          action: "step",
          id: task.id,
          command: { kind: "recover" },
        }),
        200,
      );
      const interrupted = await current(fixture, task);
      if (interrupted.state === "failed")
        expectStatus(
          await fixture.request(path(task) + "/resume", {
            body: { expectedRevision: interrupted.revision },
          }),
          200,
        );
      expectStatus(
        await fixture.control({
          action: "step",
          id: task.id,
          command: { kind: "claim", claimId: "new-builder", leaseMs: 60000 },
        }),
        200,
      );
      const restart = await operate(fixture, task, "start", {
        id: "restart",
        ...reference,
      });
      expectStatus(restart, 200);
      assert.equal(
        restart.body.receipt.status,
        "completed",
        JSON.stringify(restart.body.receipt),
      );
      assert.equal(restart.body.identity.resourceId, identity.resourceId);
      const observed = await status(fixture, identity);
      assert.equal(observed.stats.vm.starts, 2);
      assert.deepEqual(observed.stats.vm.files, files());
      assert.equal((await current(fixture, task)).usage.toolCalls, 3);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "missing workspace bindings and non-build claims cannot reserve tools or create workspaces",
  options,
  async () => {
    for (const workspaces of [false, true]) {
      const fixture = await taskFixture({ workspaces });
      try {
        const task = await building(fixture);
        if (workspaces) {
          await fixture.control({
            action: "step",
            id: task.id,
            command: { kind: "checkpoint", stepId: "publish" },
          });
          await fixture.control({
            action: "step",
            id: task.id,
            command: { kind: "claim", claimId: "publisher", leaseMs: 60000 },
          });
        }
        expectStatus(
          await operate(fixture, task, "save", {
            id: "save",
            expectedRevision: 0,
            files: files(),
          }),
          409,
        );
        assert.equal((await current(fixture, task)).usage.toolCalls, 0);
        assert.equal((await current(fixture, task)).usage.reservedToolCalls, 0);
        assert.equal((await rows(fixture)).operations.length, 0);
      } finally {
        await fixture.close();
      }
    }
  },
);

test(
  "failed generated tests retain their actual exit status and release compute",
  options,
  async () => {
    const fixture = await taskFixture({
      workspaces: true,
      workspaceEffects: async (request) =>
        Response.json(
          (await request.json()).kind === "execute"
            ? { exitCode: 1, stdout: "assertion failed" }
            : {},
        ),
    });
    try {
      const task = await building(fixture);
      const { reference, identity } = await prepare(fixture, task, files());
      const result = await operate(
        fixture,
        task,
        "command",
        command(reference),
      );
      expectStatus(result, 200);
      assert.equal(
        result.body.receipt.status,
        "completed",
        "The command ran; this does not mean its tests passed",
      );
      assert.deepEqual(result.body.receipt.result, {
        stdout: "assertion failed",
        stderr: "",
        exitCode: 1,
      });
      assert.equal((await status(fixture, identity)).stats.vm.running, false);
      assert.deepEqual(
        (await status(fixture, identity)).observation.source.files,
        files(),
      );
      assert.equal((await current(fixture, task)).state, "running");
      assert.equal((await current(fixture, task)).result, null);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "workspace operations continue past 24 calls and exact replay is charged once",
  options,
  async () => {
    const fixture = await taskFixture({ workspaces: true });
    try {
      const task = await building(fixture);
      for (const command of [
        { kind: "reserve_usage", modelTurns: 0, toolCalls: 24 },
        { kind: "settle_usage", modelTurns: 0, toolCalls: 24, consumed: true },
      ])
        expectStatus(
          await fixture.control({ action: "step", id: task.id, command }),
          200,
        );
      const input = { id: "after-24", expectedRevision: 0, files: files() };
      const result = await operate(fixture, task, "save", input);
      expectStatus(result, 200);
      assert.deepEqual(
        (await operate(fixture, task, "save", input)).body,
        result.body,
      );
      assert.equal((await rows(fixture)).operations.length, 1);
      const fresh = await current(fixture, task);
      assert.equal(fresh.usage.toolCalls, 25);
      assert.equal(fresh.usage.reservedToolCalls, 0);
    } finally {
      await fixture.close();
    }
  },
);
