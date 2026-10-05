import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { createTask } from "../packages/pvo-assistant/tasks/index.js";
import { input, hash, now } from "./assistant-tasks/fixtures.mjs";

const bundle = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
    export * from './editor/src/domain/assistant/taskProjectLink.ts';
    export * from './editor/src/state/assistant/taskProjectCommands.ts';
    export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';
    export { useCapture } from './editor/src/state/captureStore.ts';
    export { initial } from './editor/src/state/project/initial.ts';
    export { useAuthGate, refreshAccountSession } from './editor/src/state/auth/authGateStore.ts';
    export { useAssistant } from './editor/src/state/assistant/assistantStore.ts';
    export { useAssistantThread, startAssistantExchange, completeAssistantExchange } from './editor/src/state/assistant/threadStore.ts';
  `,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const state = () => api.useCapture.getState();
const ref = (
  ownerId = "owner-one",
  projectId = "server-project",
  taskId = "task-one",
) => ({ ownerId, projectId, taskId });
const task = (reference = ref()) =>
  createTask(
    { ...input(), projectId: reference.projectId },
    {
      id: reference.taskId,
      ownerId: reference.ownerId,
      now,
      inputDigest: hash,
    },
  );
function reset() {
  api.useCapture.setState(api.initial());
  state().patch({ localId: "local-project", screen: "editor" });
  account("owner-one");
}
function account(ownerId) {
  api.useAuthGate.setState({
    phase: "ready",
    user: ownerId ? { id: ownerId, name: ownerId } : null,
  });
}
function link(reference = ref()) {
  api.linkSavedTask(api.beginTaskLinkRequest(), task(reference));
}

test("checkpoint round trip preserves only task locators alongside local media and draft history", () => {
  reset();
  state().patch({
    clips: [{ id: 1, url: "blob:local", srcDur: 3, in: 0, out: 3, speed: 1 }],
  });
  state().edit({ ratio: "1:1" });
  link();
  const draft = api.captureCheckpoint(state());
  assert.deepEqual(draft.assistantTaskLinks, {
    localId: "local-project",
    accounts: [ref()],
  });
  assert.equal(
    JSON.stringify(draft.assistantTaskLinks).includes("request"),
    false,
  );
  const record = api.storeCheckpoint(
    draft,
    new Map([["blob:local", "asset:one"]]),
    now,
  );
  api.validateCheckpoint(record);
  const restored = api.restoreCheckpoint(
    structuredClone(record),
    new Map([["asset:one", "blob:restored"]]),
  );
  assert.deepEqual(restored.assistantTaskLinks, draft.assistantTaskLinks);
  assert.equal(restored.project.scenes[0].clips[0].url, "blob:restored");
  assert.equal(restored.past[0].scenes[0].clips[0].url, "blob:restored");
  restored.assistantTaskLinks.accounts[0].taskId = "changed";
  assert.equal(record.assistantTaskLinks.accounts[0].taskId, "task-one");
});

test("renames and ordinary Undo preserve the association while local identity replacement clears it", () => {
  reset();
  link();
  const links = state().assistantTaskLinks;
  state().patch({ projectName: "New name" });
  state().edit({ ratio: "16:9" });
  state().undo();
  assert.equal(state().assistantTaskLinks, links);
  assert.deepEqual(api.currentTaskReference(), ref());
  state().patch({ localId: "a-different-draft" });
  assert.equal(state().assistantTaskLinks, null);
  assert.equal(api.currentTaskReference(), null);
});

test("account switches hide another owner's locator and synchronously clear visible conversation", () => {
  reset();
  link();
  api.useAssistant.setState({
    draft: "Private draft",
    history: [{ role: "user", content: "Private history" }],
    progress: "Private progress",
  });
  const exchange = api.startAssistantExchange("Private request");
  account("owner-two");
  assert.equal(api.currentTaskReference(), null);
  assert.equal(api.useAssistant.getState().draft, "");
  assert.deepEqual(api.useAssistant.getState().history, []);
  assert.deepEqual(api.useAssistantThread.getState().items, []);
  api.completeAssistantExchange(exchange, { response: "Late private answer" });
  assert.deepEqual(api.useAssistantThread.getState().items, []);
  link(ref("owner-two", "second-project", "second-task"));
  assert.equal(api.currentTaskReference().taskId, "second-task");
  account(null);
  assert.equal(api.currentTaskReference(), null);
  assert.throws(() => api.beginTaskLinkRequest(), /sign in/);
  account("owner-one");
  assert.deepEqual(api.currentTaskReference(), ref());
});

test("session expiry clears task visibility through the actual account refresh boundary", async () => {
  reset();
  link();
  api.startAssistantExchange("Private pending question");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      available: true,
      user: null,
      clerkAvailable: false,
      clerkPublishableKey: null,
      canLinkEmail: false,
      emailLinked: false,
    });
  try {
    await api.refreshAccountSession();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(api.currentTaskReference(), null);
  assert.deepEqual(api.useAssistantThread.getState().items, []);
  assert.equal(state().assistantTaskLinks.accounts[0].taskId, "task-one");
});

test("late attachment cannot cross account/project changes, return trips, or a newer attached task", () => {
  for (const change of [
    () => account("owner-two"),
    () => {
      account("owner-two");
      account("owner-one");
    },
    () => state().patch({ localId: "another-project" }),
    () => {
      state().patch({ localId: "another-project" });
      state().patch({ localId: "local-project" });
    },
    () => link(ref("owner-one", "server-project", "newer-task")),
  ]) {
    reset();
    const request = api.beginTaskLinkRequest();
    change();
    const before = state().assistantTaskLinks;
    assert.throws(() => api.linkSavedTask(request, task()), /changed/);
    assert.equal(state().assistantTaskLinks, before);
  }
});

test("wrong-owner tasks and silent server-project reassignment are rejected without changing local links", () => {
  reset();
  assert.throws(
    () =>
      api.linkSavedTask(api.beginTaskLinkRequest(), task(ref("other-owner"))),
    /different account/,
  );
  assert.equal(state().assistantTaskLinks, null);
  link();
  assert.throws(
    () => link(ref("owner-one", "different-project")),
    /different server project/,
  );
  link(ref("owner-one", "server-project", "next-task"));
  assert.equal(api.currentTaskReference().taskId, "next-task");
});

test("a stored project copy shares local media but never its task association", () => {
  reset();
  link();
  const original = api.storeCheckpoint(
    api.captureCheckpoint(state()),
    new Map(),
    now,
  );
  const copy = api.copyProjectCheckpoint(
    original,
    "copy-project",
    "Copied edit",
    now + 1,
  );
  assert.equal(copy.assistantTaskLinks, undefined);
  assert.deepEqual(original.assistantTaskLinks.accounts, [ref()]);
  assert.deepEqual(copy.project, original.project);
  assert.deepEqual(copy.assetIds, original.assetIds);
  assert.equal(copy.localId, "copy-project");
  assert.equal(api.restoreCheckpoint(copy, new Map()).assistantTaskLinks, null);
  assert.throws(
    () =>
      api.copyProjectCheckpoint(original, original.localId, "Overwrite", now),
    /distinct/,
  );
});

test("malformed, foreign-project, credential-bearing and unbounded associations fail checkpoint validation", () => {
  reset();
  link();
  const record = api.storeCheckpoint(
    api.captureCheckpoint(state()),
    new Map(),
    now,
  );
  for (const mutate of [
    (value) => {
      value.assistantTaskLinks.localId = "another-draft";
    },
    (value) => {
      value.assistantTaskLinks.accounts[0].token = "private";
    },
    (value) => {
      value.assistantTaskLinks.accounts[0].taskId = "x".repeat(129);
    },
    (value) => {
      value.assistantTaskLinks.accounts.push(ref());
    },
    (value) => {
      value.assistantTaskLinks.accounts = new Array(1);
    },
    (value) => {
      value.assistantTaskLinks.accounts = Array.from({ length: 9 }, (_, i) =>
        ref(`owner-${i}`),
      );
    },
    (value) => {
      value.assistantTaskLinks.accounts = [];
    },
    (value) => {
      value.assistantTaskLinks = null;
    },
  ]) {
    const bad = structuredClone(record);
    mutate(bad);
    assert.throws(() => api.validateCheckpoint(bad));
  }
});
