import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: {
  contents: 'export * from "./editor/src/app/projectAutosaveController.ts"; export { initial } from "./editor/src/state/project/initial.ts";',
  resolveDir: process.cwd(),
}, bundle: true, write: false, platform: "browser", format: "esm" });
const { createProjectAutosaveController, initial } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function fixture(t) {
  let state = initial();
  let storage = { phase: "idle", dirty: false, savedAt: null, error: null };
  let restore = async () => null;
  let discard = async () => {};
  let flush = async () => publish({ phase: "saved", dirty: false, savedAt: 1, error: null });
  const stateListeners = new Set();
  const storageListeners = new Set();
  const calls = { restores: 0, discards: 0, schedules: [], hydrated: [], failed: [], recovered: [] };
  const patch = values => {
    const previous = state;
    state = { ...state, ...values };
    stateListeners.forEach(listener => listener(state, previous));
  };
  const publish = value => { storage = value; storageListeners.forEach(listener => listener()); };
  const controller = createProjectAutosaveController({
    store: { getState: () => state, subscribe: listener => { stateListeners.add(listener); return () => stateListeners.delete(listener); } },
    persistence: {
      restore: () => { calls.restores++; return restore(); },
      discardSavedProject: () => { calls.discards++; return discard(); },
      schedule: value => calls.schedules.push(value),
      flush: () => flush(),
      getStatus: () => storage,
      subscribeStatus: listener => { storageListeners.add(listener); return () => storageListeners.delete(listener); },
    },
    hydrate: saved => { calls.hydrated.push(saved); patch({ ratio: saved.project.ratio }); },
    failed: (id, error) => calls.failed.push({ id, error }),
    recovered: id => calls.recovered.push(id),
  });
  t.after(() => controller.dispose());
  return { controller, calls, patch, publish,
    setRestore: handler => { restore = handler; }, setDiscard: handler => { discard = handler; },
    setFlush: handler => { flush = handler; },
    listeners: () => ({ state: stateListeners.size, storage: storageListeners.size }),
  };
}

test("failed startup never schedules an empty or newly edited project over the unread checkpoint", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("temporarily blocked"); });
  await f.controller.start();
  assert.equal(f.controller.getStatus().phase, "restore-failed");
  assert.equal(f.calls.failed[0].id, "restoreFailed");
  f.patch({ ratio: "4:5" });
  assert.equal(f.controller.getStatus().recoveryBlocked, true);
  assert.equal(f.calls.schedules.length, 0);
  await f.controller.retry();
  assert.equal(f.calls.restores, 1, "Retry must not load over this session's new work");
  await assert.rejects(f.controller.saveBeforeUpdate(), /temporarily blocked/);
  assert.equal(f.calls.schedules.length, 0);
});

test("an explicit successful recovery hydrates first, then enables normal saving", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("blocked"); });
  await f.controller.start();
  const saved = { project: { ratio: "4:5" } };
  f.setRestore(async () => saved);
  await f.controller.retry();
  assert.deepEqual(f.calls.hydrated, [saved]);
  assert.equal(f.controller.getStatus().phase, "ready");
  assert.equal(f.calls.schedules.length, 1);
  assert.equal(f.calls.schedules[0].ratio, "4:5");
  assert(f.calls.recovered.includes("restoreFailed"));
  f.patch({ ratio: "1:1" });
  assert.equal(f.calls.schedules.at(-1).ratio, "1:1");
});

test("explicit discard removes an unread checkpoint before saving can resume", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("unsupported checkpoint"); });
  await f.controller.start();

  assert.equal(await f.controller.discardRecovery(), true);
  assert.equal(f.calls.discards, 1);
  assert.equal(f.controller.getStatus().phase, "ready");
  assert.equal(f.calls.schedules.length, 0, "A clean placeholder must not replace another current project");
  assert(f.calls.recovered.includes("restoreFailed"));
  await f.controller.saveBeforeUpdate();
  assert.equal(f.calls.schedules.length, 0, "The create preflight must still skip the clean placeholder");
  f.patch({ localId: "replacement-project", screen: "editor" });
  assert.equal(f.calls.schedules.length, 1);
});

test("discard cannot remove a saved checkpoint after new in-memory work begins", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("unsupported checkpoint"); });
  await f.controller.start();
  f.patch({ ratio: "4:5" });

  assert.equal(await f.controller.discardRecovery(), false);
  assert.equal(f.calls.discards, 0);
  assert.equal(f.calls.schedules.length, 0);
  assert.equal(f.controller.getStatus().phase, "restore-failed");
  assert.equal(f.controller.getStatus().recoveryBlocked, true);
});

test("failed checkpoint deletion leaves recovery blocked and reports the failure", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("unsupported checkpoint"); });
  f.setDiscard(async () => { throw new Error("storage blocked"); });
  await f.controller.start();

  assert.equal(await f.controller.discardRecovery(), false);
  assert.equal(f.calls.discards, 1);
  assert.equal(f.calls.schedules.length, 0);
  assert.equal(f.controller.getStatus().phase, "restore-failed");
  assert.match(f.calls.failed.at(-1).error.message, /storage blocked/);
});

test("replacement work completed during checkpoint deletion is scheduled after discard", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("unsupported checkpoint"); });
  let finishDiscard;
  f.setDiscard(() => new Promise(resolve => { finishDiscard = resolve; }));
  await f.controller.start();

  const discarding = f.controller.discardRecovery();
  f.patch({ ratio: "4:5" });
  finishDiscard();
  assert.equal(await discarding, true);
  assert.equal(f.controller.getStatus().phase, "ready");
  assert.equal(f.calls.schedules.length, 1);
  assert.equal(f.calls.schedules[0].ratio, "4:5");
});

test("new edits arriving during async recovery preserve both projects and leave saving paused", async t => {
  const f = fixture(t);
  f.setRestore(async () => { throw new Error("blocked"); });
  await f.controller.start();
  let finish;
  f.setRestore(() => new Promise(resolve => { finish = resolve; }));
  const retry = f.controller.retry();
  assert.equal(f.controller.getStatus().phase, "retrying");
  f.patch({ ratio: "1:1" });
  finish({ project: { ratio: "4:5" } });
  await retry;
  assert.equal(f.calls.hydrated.length, 0);
  assert.equal(f.calls.schedules.length, 0);
  assert.equal(f.controller.getStatus().phase, "restore-failed");
  assert.equal(f.controller.getStatus().recoveryBlocked, true);
});

test("a recording or import started during recovery prevents hydration even before a clip exists", async t => {
  for (const operation of ["recording", "importing"]) {
    const f = fixture(t);
    let finish;
    f.setRestore(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.controller.start();
    f.patch({ [operation]: true });
    finish({ project: { ratio: "4:5" } });
    await pending;
    assert.equal(f.calls.hydrated.length, 0, operation);
    assert.equal(f.calls.schedules.length, 0, operation);
  }
});

test("save failures resolve only after a clean successful save, including explicit retry", async t => {
  const f = fixture(t);
  await f.controller.start();
  f.patch({ ratio: "4:5" });
  f.publish({ phase: "error", dirty: true, savedAt: null, error: "quota" });
  assert.equal(f.calls.failed.at(-1).id, "saveFailed");
  f.publish({ phase: "saved", dirty: true, savedAt: 1, error: null });
  assert.equal(f.calls.recovered.includes("saveFailed"), false);
  await f.controller.retry();
  assert.equal(f.calls.recovered.at(-1), "saveFailed");
});

test("repeated startup shares one restoration and dispose releases workflow subscriptions", async t => {
  const f = fixture(t);
  await Promise.all([f.controller.start(), f.controller.start()]);
  assert.equal(f.calls.restores, 1);
  assert.equal(f.calls.schedules.length, 1);
  assert.deepEqual(f.listeners(), { state: 1, storage: 1 });
  f.controller.dispose();
  assert.deepEqual(f.listeners(), { state: 0, storage: 0 });
});
