import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createTask,
  transitionTask,
} from "../../packages/pvo-assistant/tasks/index.js";
import {
  prepareTaskResult,
  serializePreparedTaskResult,
} from "../../packages/pvo-assistant/results/index.js";
import { api, proposal, deferred } from "./helpers.mjs";
const state = () => api.useCapture.getState();
const project = () => api.projectSnapshot(state());
const media = new Map([["blob:original", "asset:original"]]);
const fingerprint = (value) =>
  api.nativeProjectFingerprint(api.remapProjectMedia(value, media));
function fixture() {
  api.useCapture.setState(api.initial());
  api.useEditorPreferences.setState({ advancedEditingEnabled: false });
  api.useAuthGate.setState({
    phase: "ready",
    user: { id: "owner", name: "Owner" },
  });
  state().patch({
    screen: "editor",
    localId: "local",
    clips: [
      { id: 1, url: "blob:original", srcDur: 3, in: 0, out: 3, speed: 1 },
    ],
  });
  const input = api.cloudTaskInput(project(), "Add a dinner card", proposal, {
    projectId: "server",
    operationId: "create",
    fingerprint: fingerprint(project()),
  });
  let task = createTask(input, {
    id: "task",
    ownerId: "owner",
    inputDigest: "a".repeat(64),
    now: Date.now(),
  });
  api.linkSavedTask(api.beginTaskLinkRequest(), task);
  task = transitionTask(
    task,
    { kind: "claim", claimId: "worker", leaseMs: 60000 },
    { ownerId: "owner", expectedRevision: 0, now: task.updatedAt, claim: null },
  );
  const result = prepareTaskResult(task, [
    {
      kind: "component.add",
      sceneId: "main",
      componentType: "tooltip",
      at: 0,
      duration: 2,
    },
  ]);
  const body = serializePreparedTaskResult(result);
  const artifact = {
    id: task.id,
    bytes: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  task = transitionTask(
    task,
    {
      kind: "complete",
      result: { artifact, baseFingerprint: input.context.fingerprint },
    },
    {
      ownerId: "owner",
      expectedRevision: task.revision,
      now: task.updatedAt,
      claim: { id: task.claim.id, generation: task.generation },
    },
  );
  let stored;
  const adapters = {
    begin: api.beginTaskLinkRequest,
    assert: api.assertTaskLinkRequest,
    flush: async () => {
      stored = api.storeCheckpoint(
        api.captureCheckpoint(state()),
        media,
        Date.now(),
      );
    },
    project,
    fingerprint,
    read: async () => task,
    result: async () => result,
    prepare: (before, value, signal) =>
      api.prepareNativeBatch(before, value.operations, {
        signal,
        createId: () => 42,
        advancedEditingEnabled: false,
        compile: async () => ({
          structure: { type: "tooltip", text: "Dinner" },
          rules: [],
          html: "",
          css: "",
          js: "",
        }),
      }),
    commit: api.commitSavedTaskResult,
  };
  const reference = {
    ownerId: task.ownerId,
    projectId: input.projectId,
    taskId: task.id,
  };
  const apply = api.createTaskApplicationWorkflow(adapters);
  return {
    task,
    result,
    body,
    reference,
    adapters,
    apply: () => apply(reference, new AbortController().signal),
    stored: () => stored,
  };
}

test("apply commits once with its checkpoint receipt; Undo, Redo and reload preserve replay protection", async () => {
  const f = fixture();
  const before = project();
  await f.apply();
  assert.equal(state().components.length, 1);
  assert.equal(state().past.length, 1);
  assert.equal(f.stored().assistantTaskLinks.applied.length, 1);
  assert.equal(f.stored().project.scenes[0].components.length, 1);
  await f.apply();
  assert.equal(state().past.length, 1);
  state().undo();
  assert.deepEqual(project(), before);
  await f.apply();
  assert.deepEqual(
    project(),
    before,
    "Undo cannot make the saved result run twice",
  );
  state().redo();
  assert.equal(state().components.length, 1);
  await f.adapters.flush();
  const restored = api.restoreCheckpoint(
    f.stored(),
    new Map([["asset:original", "blob:restored"]]),
  );
  media.set("blob:restored", "asset:original");
  state().patch({
    ...restored.project,
    assistantTaskLinks: restored.assistantTaskLinks,
  });
  await f.apply();
  assert.equal(state().components.length, 1);
  assert.equal(
    api.copyProjectCheckpoint(f.stored(), "copy", "Copy", Date.now())
      .assistantTaskLinks,
    undefined,
  );
});

test("persisted media identity is stable after reopening and changes for replaced media or edits", () => {
  const f = fixture();
  const before = project();
  const record = api.storeCheckpoint(
    api.captureCheckpoint(state()),
    media,
    Date.now(),
  );
  const restored = api.restoreCheckpoint(
    record,
    new Map([["asset:original", "blob:new-session"]]),
  );
  const stable = api.nativeProjectFingerprint(
    api.remapProjectMedia(
      restored.project,
      new Map([["blob:new-session", "asset:original"]]),
    ),
  );
  assert.equal(stable, f.result.baseFingerprint);
  assert.notEqual(
    api.nativeProjectFingerprint(restored.project),
    api.nativeProjectFingerprint(before),
  );
  assert.notEqual(
    api.nativeProjectFingerprint(
      api.remapProjectMedia(
        restored.project,
        new Map([["blob:new-session", "asset:replacement"]]),
      ),
    ),
    stable,
  );
  assert.notEqual(fingerprint({ ...before, ratio: "1:1" }), stable);
});

test("changed draft and changes during compilation are preserved without a receipt", async () => {
  let f = fixture();
  state().edit({ ratio: "1:1" });
  await assert.rejects(f.apply(), /draft changed/);
  assert.equal(state().ratio, "1:1");
  assert.equal(state().assistantTaskLinks.applied, undefined);
  f = fixture();
  const prepare = f.adapters.prepare;
  f.adapters.prepare = async (...args) => {
    const batch = await prepare(...args);
    state().edit({ ratio: "16:9" });
    return batch;
  };
  await assert.rejects(f.apply(), /project changed/);
  assert.equal(state().ratio, "16:9");
  assert.equal(state().components.length, 0);
  assert.equal(state().assistantTaskLinks.applied, undefined);
});

test("account replacement and invalid complete batch cannot leak partial edits", async () => {
  let f = fixture();
  f.adapters.result = async () => {
    api.useAuthGate.setState({ user: { id: "other", name: "Other" } });
    return f.result;
  };
  await assert.rejects(f.apply(), /account changed/);
  assert.equal(state().components.length, 0);
  f = fixture();
  f.result.operations.push({
    kind: "component.delete",
    sceneId: "main",
    componentId: "missing",
  });
  await assert.rejects(f.apply(), /no longer exists/);
  assert.equal(state().components.length, 0);
  assert.equal(state().past.length, 0);
});

test("failed final checkpoint retains an in-memory receipt and retry saves without reapplying", async () => {
  const f = fixture();
  const flush = f.adapters.flush;
  f.adapters.flush = async () => {
    if (state().assistantTaskLinks.applied) throw new Error("disk full");
    await flush();
  };
  await assert.rejects(f.apply(), api.TaskResultSaveError);
  assert.equal(state().components.length, 1);
  assert.equal(state().assistantTaskLinks.applied.length, 1);
  assert.equal(f.stored().project.scenes[0].components.length, 0);
  assert.equal(f.stored().assistantTaskLinks.applied, undefined);
  f.adapters.flush = flush;
  await f.apply();
  assert.equal(state().past.length, 1);
  assert.equal(f.stored().assistantTaskLinks.applied.length, 1);
});

test("overlapping apply attempts and receipt replacement are rejected", async () => {
  const f = fixture();
  const wait = deferred();
  f.adapters.result = async () => {
    await wait.promise;
    return f.result;
  };
  const first = f.apply();
  await assert.rejects(f.apply(), /already being applied/);
  wait.resolve();
  await first;
  const receipt = state().assistantTaskLinks.applied[0];
  assert.throws(
    () =>
      api.recordTaskApplication(state().assistantTaskLinks, {
        ...receipt,
        artifact: { ...receipt.artifact, sha256: "b".repeat(64) },
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      api.recordTaskApplication(state().assistantTaskLinks, {
        ...receipt,
        taskId: "old-task",
      }),
    /current saved task/,
  );
});

test("result transport verifies actual bytes and never follows a supplied URL", async () => {
  const f = fixture();
  const original = globalThis.fetch;
  try {
    let body = f.body;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/assistant/tasks/task/result");
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "same-origin");
      return new Response(body, {
        headers: { "Content-Type": "application/json" },
      });
    };
    assert.deepEqual(
      await api.readSavedResult(f.task, new AbortController().signal),
      f.result,
    );
    body += " ";
    await assert.rejects(
      api.readSavedResult(f.task, new AbortController().signal),
      /did not match/,
    );
    body = "x".repeat(1048577);
    await assert.rejects(
      api.readSavedResult(f.task, new AbortController().signal),
    );
  } finally {
    globalThis.fetch = original;
  }
});
