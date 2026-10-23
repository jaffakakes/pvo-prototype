import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      export { clearSelection } from './editor/src/state/editing/clearSelection.ts';
      export { useCapture } from './editor/src/state/captureStore.ts';
      export { useAssistant } from './editor/src/state/assistant/assistantStore.ts';
      export { initial } from './editor/src/state/project/initial.ts';
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
function reset(sheet = "volume") {
  api.useCapture.setState(api.initial());
  api.useAssistant.setState({ phase: "idle", minimized: false });
  state().patch({ sheet, sel: 0 });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("collapse waits for the shared animated close and leaves project history intact", async () => {
  reset();
  const before = state();
  const closing = deferred();
  const pending = api.clearSelection(async () => {
    await closing.promise;
    state().patch({ sheet: null });
  });
  assert.equal(state().sel, 0);
  assert.equal(state().sheet, "volume");
  closing.resolve();
  await pending;
  assert.equal(state().sheet, null);
  assert.equal(state().sel, -1);
  assert.deepEqual(state().scenes, before.scenes);
  assert.equal(state().past, before.past);
  assert.equal(state().future, before.future);
});

test("a guarded or nested close keeps the selection and panel intact", async () => {
  reset();
  await api.clearSelection(() => {});
  assert.equal(state().sel, 0);
  assert.equal(state().sheet, "volume");
  await api.clearSelection(() => state().patch({ sheet: "crop" }));
  assert.equal(state().sel, 0);
  assert.equal(state().sheet, "crop");
});

test("a normal text close commits its draft before collapsing the selection", async () => {
  reset("text");
  const past = state().past.length;
  await api.clearSelection(() => {
    state().addText("Keep this draft");
    state().patch({ sheet: null });
  });
  assert.equal(state().texts[0].text, "Keep this draft");
  assert.equal(state().past.length, past + 1);
  assert.equal(state().selText, null);
  assert.equal(state().sel, -1);
});

test("a later selection or project is not cleared when an old close finishes", async () => {
  for (const change of [
    { sel: 1 },
    { selText: 7 },
    { currentSceneId: "other" },
    { localId: "other-project" },
  ]) {
    reset();
    const closing = deferred();
    const pending = api.clearSelection(() => closing.promise);
    api.useCapture.setState({ sheet: null, ...change });
    const expected = state();
    closing.resolve();
    await pending;
    for (const key of [
      "sel",
      "selText",
      "selComp",
      "selAudio",
      "currentSceneId",
      "localId",
    ])
      assert.equal(state()[key], expected[key]);
  }
});

test("assistant focus acquired during closing preserves the selected layer", async () => {
  reset();
  const closing = deferred();
  const pending = api.clearSelection(() => closing.promise);
  state().patch({ sheet: null });
  api.useAssistant.setState({ phase: "typing" });
  closing.resolve();
  await pending;
  assert.equal(state().sel, 0);
});

test("collapse with no panel clears immediately; a panel without a close handler stays open", async () => {
  reset(null);
  const pending = api.clearSelection();
  assert.equal(state().sel, -1);
  await pending;
  reset();
  await api.clearSelection();
  assert.equal(state().sel, 0);
  assert.equal(state().sheet, "volume");
});
