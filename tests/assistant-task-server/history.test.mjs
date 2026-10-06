import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, path, expectStatus, NOW } from "./helpers.mjs";

import {
  building,
  operate,
  rows,
  status,
  files,
} from "./workspace.helpers.mjs";

const step = async (f, task, command) => {
  const result = await f.control({ action: "step", id: task.id, command });
  expectStatus(result, 200);
  return result.body;
};
const record = (index) => ({
  id: `receipt-${index}`,
  stepId: "plan",
  inputDigest: "a".repeat(64),
  status: "planned",
  resources: [],
  artifact: null,
  failure: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const read = async (f, task) => (await f.request(path(task))).body.task;
const page = async (f, task, after = 0) => {
  const result = await f.control({
    action: "operation-history",
    id: task.id,
    after,
  });
  expectStatus(result, 200);
  return result.body;
};
const start = async (f) =>
  step(f, await saved(f), {
    kind: "claim",
    claimId: "history-worker",
    leaseMs: 60000,
  });

test("100 receipts cross the former history cutoff, survive restart and keep exact replay and ownership", async () => {
  const f = await taskFixture();
  try {
    let task = await start(f);
    for (let index = 0; index < 100; index++) {
      task = await step(f, task, {
        kind: "record_operation",
        operation: record(index),
      });
      task = await step(f, task, {
        kind: "record_operation",
        operation: { ...record(index), status: "completed" },
      });
    }
    assert.equal(task.archivedOperations + task.operations.length, 100);
    assert.ok(task.operations.length <= 32);
    const all = [];
    let cursor = 0;
    do {
      const result = await page(f, task, cursor);
      assert.ok(result.entries.length <= 8);
      all.push(...result.entries);
      cursor = result.next;
    } while (cursor !== null);
    assert.equal(all.length, task.archivedOperations);
    assert.equal(all[0].operation.id, "receipt-0");
    await f.restart();
    assert.deepEqual(await read(f, task), task);
    assert.deepEqual((await page(f, task)).entries, all.slice(0, 8));
    const replay = await step(f, task, {
      kind: "record_operation",
      operation: all[0].operation,
    });
    assert.deepEqual(replay, task);
    expectStatus(
      await f.control({
        action: "step",
        id: task.id,
        command: {
          kind: "record_operation",
          operation: { ...all[0].operation, status: "planned" },
        },
      }),
      409,
    );
    expectStatus(
      await f.control({
        action: "step",
        id: task.id,
        command: {
          kind: "record_operation",
          operation: { ...all[0].operation, inputDigest: "b".repeat(64) },
        },
      }),
      409,
    );
    expectStatus(
      await f.request("/__test", {
        session: f.otherCookie,
        body: {
          action: "operation-history",
          id: task.id,
          after: 0,
        },
      }),
      409,
    );
    task = await step(f, task, {
      kind: "record_operation",
      operation: record(100),
    });
    const stopped = await f.request(path(task) + "/stop", {
      body: { expectedRevision: task.revision },
    });
    expectStatus(stopped, 200);
    assert.equal(stopped.body.task.operations.at(-1).status, "unknown");
    assert.deepEqual((await page(f, task)).entries, all.slice(0, 8));
  } finally {
    await f.close();
  }
});

test("archive failure rolls back the receipt checkpoint and leaves unfinished work recoverable", async () => {
  const f = await taskFixture();
  try {
    let task = await start(f);
    for (let index = 0; index < 32; index++) {
      task = await step(f, task, {
        kind: "record_operation",
        operation: record(index),
      });
      task = await step(f, task, {
        kind: "record_operation",
        operation: { ...record(index), status: "completed" },
      });
    }
    task = await step(f, task, {
      kind: "record_operation",
      operation: record(32),
    });
    assert.equal(task.operations.length, 33);
    expectStatus(
      await f.control({ action: "history-write-failure", enabled: true }),
      200,
    );
    const command = {
      kind: "record_operation",
      operation: { ...record(32), status: "completed" },
    };
    const failed = await f.control({ action: "step", id: task.id, command });
    assert.ok(failed.status >= 400);
    assert.deepEqual(await read(f, task), task);
    assert.deepEqual((await page(f, task)).entries, []);
    expectStatus(
      await f.control({ action: "history-write-failure", enabled: false }),
      200,
    );
    const settled = await step(f, task, command);
    assert.equal(settled.archivedOperations, 1);
    assert.equal(settled.operations.at(-1).status, "completed");
    assert.equal((await page(f, task)).entries[0].operation.id, "receipt-0");
  } finally {
    await f.close();
  }
});

test("100 actual workspace writes checkpoint usage and retain the exact source and first receipt through restart", async () => {
  const f = await taskFixture({ workspaces: true });
  try {
    let task = await building(f);
    let first;
    for (let index = 0; index < 100; index++) {
      const result = await operate(f, task, "save", {
        id: `write-${index}`,
        expectedRevision: index,
        files: files(),
      });
      expectStatus(result, 200);
      first ??= result.body;
    }
    task = await read(f, task);
    assert.equal(task.usage.toolCalls, 100);
    assert.equal(task.usage.reservedToolCalls, 0);
    assert.equal(task.operations.length + task.archivedOperations, 100);
    assert.ok(task.operations.length <= 33);
    const source = (await status(f, first.identity)).observation.source;
    assert.equal(source.revision, 100);
    await f.restart();
    assert.deepEqual(await read(f, task), task);
    assert.deepEqual(
      (await status(f, first.identity)).observation.source,
      source,
    );
    const replay = await operate(f, task, "save", {
      id: "write-0",
      expectedRevision: 0,
      files: files(),
    });
    expectStatus(replay, 200);
    assert.deepEqual(replay.body, first);
    assert.equal((await rows(f)).operations.length, 100);
    assert.deepEqual(await read(f, task), task);
  } finally {
    await f.close();
  }
});
