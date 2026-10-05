import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareTaskResult,
  parsePreparedTaskResult,
  matchPreparedTaskResult,
  serializePreparedTaskResult,
  parseTaskApplication,
} from "../../packages/pvo-assistant/results/index.js";
import { create, hash } from "./fixtures.mjs";
const operations = [
  {
    kind: "component.content",
    sceneId: "scene-one",
    componentId: "form-one",
    changes: { heading: "Dinner" },
  },
];

test("prepared results derive ownership and reject host effects, injected fields and mismatched tasks", () => {
  const task = create();
  const result = prepareTaskResult(task, operations);
  assert.equal(result.taskId, task.id);
  assert.equal(result.ownerId, task.ownerId);
  assert.deepEqual(matchPreparedTaskResult(result, task), result);
  for (const key of ["taskId", "ownerId", "projectId", "baseFingerprint"])
    assert.throws(() =>
      matchPreparedTaskResult({ ...result, [key]: "other" }, task),
    );
  for (const kind of [
    "playback.play",
    "export.prepare",
    "font.install",
    "provider.deploy",
  ])
    assert.throws(() => prepareTaskResult(task, [{ kind }]));
  for (const value of [
    { ...result, token: "secret" },
    { ...result, operations: [] },
    { ...result, operations: Array(25).fill(operations[0]) },
  ])
    assert.throws(() => parsePreparedTaskResult(value));
  assert.throws(() =>
    prepareTaskResult(task, [{ ...operations[0], ownerId: "other" }]),
  );
});

test("prepared bytes are canonical; local receipts are bounded identity metadata", () => {
  const result = prepareTaskResult(create(), operations);
  const reversed = Object.fromEntries(Object.entries(result).reverse());
  assert.equal(
    serializePreparedTaskResult(result),
    serializePreparedTaskResult(reversed),
  );
  const receipt = {
    ownerId: result.ownerId,
    projectId: result.projectId,
    taskId: result.taskId,
    artifact: { id: result.taskId, sha256: hash, bytes: 20 },
  };
  assert.deepEqual(parseTaskApplication(receipt), receipt);
  assert.throws(() => parseTaskApplication({ ...receipt, operations }));
  assert.throws(() =>
    parseTaskApplication({
      ...receipt,
      artifact: { ...receipt.artifact, bytes: 1048577 },
    }),
  );
});
