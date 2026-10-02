import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
  export { appliedAssistantSummary } from './editor/src/domain/assistant/appliedSummary.ts';
  export { applyAssistantChanges } from './editor/src/state/assistant/applyChanges.ts';
  export { notifyAssistantApplied, performNotificationAction } from './editor/src/state/assistant/nativeAppliedNotification.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { useAssistant, resetAssistant } from './editor/src/state/assistant/assistantStore.ts';
  export { useNotifications, resetNotifications, dismissNotification } from './editor/src/state/notifications/notificationStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { projectSnapshot } from './editor/src/state/project/history.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const state = () => api.useCapture.getState();
const snapshot = () => api.projectSnapshot(state());
const operations = [
  { kind: "text.add", sceneId: "main", text: "A real change", start: 1, end: 3 },
  { kind: "clip.trim", sceneId: "main", clipId: 100, sourceIn: 1, sourceOut: 8 },
];
function reset() {
  api.resetNotifications();
  api.resetAssistant();
  api.useCapture.setState(api.initial());
  state().patch({ screen: "editor", localId: "project-1", clips: [
    { id: 100, url: null, srcDur: 10, in: 0, out: 10, speed: 1, zoom: 1, mirror: false, fit: "cover", color: "#000" },
  ] });
  return snapshot();
}
async function prepare(commands = operations) {
  let id = 1000;
  return api.prepareNativeBatch(snapshot(), commands, { createId: () => id++, advancedEditingEnabled: false,
    compile: async () => { throw new Error("Unexpected compilation"); } });
}
async function apply() {
  const batch = await prepare();
  const receipt = api.applyAssistantChanges(batch);
  api.notifyAssistantApplied(receipt, batch.operations, "applied-1");
  return receipt;
}

test("validated assistant edits apply in one history step and their notification undoes exactly that step", async () => {
  const before = reset();
  await apply();
  assert.equal(state().past.length, 1);
  assert.equal(state().texts[0].text, "A real change");
  assert.equal(state().clips[0].in, 1);
  const notice = api.useNotifications.getState().current;
  assert.equal(notice.id, "assistantApplied");
  assert.equal(notice.summary, "Text added · Clip trimmed");
  assert.equal(notice.action, "undoAssistantEdit");
  assert.equal(api.performNotificationAction(), true);
  assert.deepEqual(snapshot(), before);
  assert.equal(state().future.length, 1);
  assert.equal(api.useNotifications.getState().current, null);
  assert.equal(api.performNotificationAction(), false);
  assert.match(api.useAssistant.getState().history.at(-1).content, /undid/);
});

test("notification Undo never consumes a later edit, another project or an undo-redo cycle", async () => {
  for (const change of [
    () => state().addText("A later manual edit"),
    () => state().patch({ localId: "project-2" }),
    () => { state().undo(); state().redo(); },
    () => state().patch({ ratio: "16:9" }),
  ]) {
    reset();
    await apply();
    change();
    const before = snapshot();
    const past = state().past;
    const future = state().future;
    assert.equal(api.performNotificationAction(), false);
    assert.deepEqual(snapshot(), before);
    assert.equal(state().past, past);
    assert.equal(state().future, future);
  }
});

test("dismissal releases the applied receipt and playback-only actions create no Undo", async () => {
  reset();
  await apply();
  api.dismissNotification();
  assert.equal(api.performNotificationAction(), false);
  const past = state().past;
  const playback = await prepare([{ kind: "playback.seek", sceneId: "main", time: 2 }]);
  assert.equal(api.applyAssistantChanges(playback), null);
  assert.equal(state().t, 2);
  assert.equal(state().past, past);
  assert.equal(api.useNotifications.getState().current, null);
});

test("stale and unsafe editor states fail before any assistant commit", async () => {
  for (const change of [() => state().addText("Manual"), () => state().patch({ recording: true })]) {
    reset();
    const batch = await prepare();
    change();
    const before = snapshot();
    const past = state().past;
    assert.throws(() => api.applyAssistantChanges(batch), /project changed|Finish recording/);
    assert.deepEqual(snapshot(), before);
    assert.equal(state().past, past);
    assert.equal(api.useNotifications.getState().current, null);
  }
});

test("applied summaries are bounded deterministic operation labels without user or model text", () => {
  const summary = api.appliedAssistantSummary([
    { kind: "text.add", text: "Never echo this private prompt" }, { kind: "component.style" },
    { kind: "clip.trim" }, { kind: "text.add", text: "Duplicate" },
  ]);
  assert.ok(summary.length <= 50);
  assert.doesNotMatch(summary, /private|Duplicate/);
  assert.match(summary, /^Text added/);
});


test("playback and export effects follow the one validated edit without adding history", async () => {
  reset();
  const batch = await prepare([...operations, { kind: "playback.seek", sceneId: "main", time: 2 },
    { kind: "export.prepare", format: "video" }]);
  const receipt = api.applyAssistantChanges(batch);
  assert.ok(receipt);
  assert.equal(state().past.length, 1);
  assert.equal(state().t, 2);
  assert.equal(state().sheet, "export");
  assert.equal(state().exportFormat, "video");
  reset();
  const invalid = await prepare();
  invalid.playback = [{ kind: "playback.seek", sceneId: "missing", time: 2 }];
  assert.throws(() => api.applyAssistantChanges(invalid), /playback position/);
  assert.equal(state().past.length, 0);
  assert.equal(state().texts.length, 0);
});
