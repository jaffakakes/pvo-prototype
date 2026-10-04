import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { projectSnapshot } from './editor/src/state/project/history.ts';
  export { nativeProjectFingerprint } from './editor/src/domain/assistant/native/context.ts';
  export { useAssistant } from './editor/src/state/assistant/assistantStore.ts';
  export { useAssistantThread, resetAssistantThread, setAssistantThreadOpen,
    setAssistantThreadCollapsed, startAssistantExchange, updateAssistantExchangeProgress,
    completeAssistantExchange, finishAssistantExchange } from './editor/src/state/assistant/threadStore.ts';
  export { assistantThreadActionAvailability, undoAssistantThreadExchange,
    redoAssistantThreadExchange, showAssistantThreadExchange } from './editor/src/state/assistant/threadCommands.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const capture = () => api.useCapture.getState();
const thread = () => api.useAssistantThread.getState();
const snapshot = () => api.projectSnapshot(capture());

function reset() {
  api.useCapture.setState(api.initial());
  capture().patch({ screen: "editor", localId: "project-1", clips: [
    { id: 100, url: null, srcDur: 10, in: 0, out: 10, speed: 1, zoom: 1,
      mirror: false, fit: "cover", color: "#000", width: 1080, height: 1920 },
  ], sel: 0 });
  api.useAssistant.setState({ history: [], phase: "idle" });
  api.resetAssistantThread();
}

function appliedExchange() {
  const id = api.startAssistantExchange("Make this wider");
  capture().edit({ ratio: "16:9" });
  const state = capture();
  api.completeAssistantExchange(id, { response: "I changed the ratio.", summary: "Aspect ratio changed",
    change: { localId: state.localId, past: state.past, future: state.future,
      fingerprint: api.nativeProjectFingerprint(snapshot()) } });
  return id;
}

test("session exchanges keep the native draft separate and clear on project change", () => {
  reset();
  capture().patch({ t: 3.5 });
  api.useAssistant.setState({ draft: "Still typing" });
  api.setAssistantThreadOpen(true);
  api.setAssistantThreadCollapsed(true);
  const id = api.startAssistantExchange("Explain the edit");
  assert.equal(thread().items[0].at, 3.5);
  api.updateAssistantExchangeProgress(id, "Reading your project…");
  assert.equal(thread().items[0].progress, "Reading your project…");
  api.completeAssistantExchange(id, { response: "Here is the answer." });
  assert.equal(thread().items[0].status, "answered");
  assert.equal(api.useAssistant.getState().draft, "Still typing");
  assert.equal(thread().open, true);
  assert.equal(thread().collapsed, true);
  capture().patch({ localId: "project-2" });
  assert.deepEqual(thread().items, []);
  assert.equal(thread().open, false);
});

test("row Undo and Redo require the exact latest project and history, and inform the planner", () => {
  reset();
  const id = appliedExchange();
  assert.equal(thread().items[0].status, "applied");
  assert.equal(api.assistantThreadActionAvailability(id).canUndo, true);
  assert.equal(api.undoAssistantThreadExchange(id).ok, true);
  assert.equal(capture().ratio, "9:16");
  assert.equal(thread().items[0].undone, true);
  assert.equal(api.assistantThreadActionAvailability(id).canRedo, true);
  assert.match(api.useAssistant.getState().history.at(-1).content, /undid/);
  assert.equal(api.redoAssistantThreadExchange(id).ok, true);
  assert.equal(capture().ratio, "16:9");
  assert.equal(thread().items[0].undone, false);
  assert.match(api.useAssistant.getState().history.at(-1).content, /redid/);
  capture().edit({ ratio: "4:5" });
  const before = snapshot();
  assert.equal(api.assistantThreadActionAvailability(id).canUndo, false);
  assert.equal(api.undoAssistantThreadExchange(id).ok, false);
  assert.deepEqual(snapshot(), before);
});

test("ordinary editor Undo and Redo update the row, and Show only navigates", () => {
  reset();
  const id = appliedExchange();
  capture().undo();
  assert.equal(thread().items[0].undone, true);
  capture().redo();
  assert.equal(thread().items[0].undone, false);
  capture().patch({ sel: -1, currentSceneId: "main" });
  const past = capture().past;
  const future = capture().future;
  assert.equal(api.assistantThreadActionAvailability(id).canShow, true);
  assert.equal(api.showAssistantThreadExchange(id).ok, true);
  assert.equal(capture().sel, 0);
  assert.equal(capture().past, past);
  assert.equal(capture().future, future);
});

test("failed and cancelled exchanges retain their request, while history stays bounded", () => {
  reset();
  const failed = api.startAssistantExchange("Try this");
  api.finishAssistantExchange(failed, "failed", "The service is unavailable.");
  assert.equal(thread().items[0].status, "failed");
  assert.equal(thread().items[0].request, "Try this");
  const cancelled = api.startAssistantExchange("Try that");
  api.finishAssistantExchange(cancelled, "cancelled");
  assert.equal(thread().items[1].status, "cancelled");
  for (let index = 0; index < 30; index += 1) api.startAssistantExchange(`Request ${index}`);
  assert.equal(thread().items.length, 24);
  assert.equal(thread().items[0].request, "Request 6");
});
