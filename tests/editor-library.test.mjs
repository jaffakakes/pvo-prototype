import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
      export * from './editor/src/domain/clips/insertion.ts';
      export * from './editor/src/state/editing/libraryCommands.ts';
      export { useCapture } from './editor/src/state/captureStore.ts';
      export { initial } from './editor/src/state/project/initial.ts';
      export { mkClip } from './editor/src/state/editing/clipFactory.ts';
      export { DEFAULT_TEXT_STYLE } from './packages/pvo-text-runtime/index.js';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { insertClipsAtPlayhead, insertLibraryClips, addLibrarySource, addLibraryComponent,
  addLibraryText, selectLibraryComponent, setLibraryMusic, useCapture, initial, mkClip, DEFAULT_TEXT_STYLE } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function setup() {
  const state = initial();
  const clips = [mkClip(10, null, 0), mkClip(8, null, 1)];
  state.scenes[0].clips = clips;
  state.clips = clips;
  useCapture.setState(state);
  return clips;
}

test("library insertion follows the clip under the playhead, accounting for trim and speed", () => {
  const first = { ...mkClip(10, null, 0), in: 2, out: 8, speed: 2 };
  const second = mkClip(6, null, 1);
  const added = mkClip(2, null, 2);
  const clips = [first, second];
  const inside = insertClipsAtPlayhead(clips, [added], 2.9);
  assert.deepEqual(inside.clips.map(item => item.id), [first.id, added.id, second.id]);
  assert.equal(inside.time, 3);
  const boundary = insertClipsAtPlayhead(clips, [added], 3);
  assert.equal(boundary.index, 2);
  assert.equal(boundary.time, 9);
  assert.deepEqual(clips, [first, second]);
  assert.equal(insertClipsAtPlayhead([], [added], 0).index, 0);
});

test("inserting a media batch selects its first clip and is one undoable edit", () => {
  const before = setup();
  useCapture.getState().patch({ t: 2, selText: 12, selComp: "old" });
  const added = [mkClip(3, null, 2), mkClip(4, null, 3)];
  insertLibraryClips(added);
  const state = useCapture.getState();
  assert.deepEqual(state.clips.map(item => item.id), [before[0].id, ...added.map(item => item.id), before[1].id]);
  assert.equal(state.sel, 1);
  assert.equal(state.t, 10);
  assert.equal(state.selComp, null);
  assert.equal(state.selText, null);
  assert.equal(state.past.length, 1);
  state.undo();
  assert.deepEqual(useCapture.getState().clips, before);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().clips.length, 4);
});

test("reusing source media inserts its full original duration with a new identity", () => {
  const clips = setup();
  const source = { ...clips[0], in: 2, out: 5, speed: 2, zoom: 2 };
  addLibrarySource(source);
  const added = useCapture.getState().clips[1];
  assert.notEqual(added.id, source.id);
  assert.equal(added.in, 0);
  assert.equal(added.out, source.srcDur);
  assert.equal(added.speed, 1);
  assert.equal(added.url, source.url);
});

test("desktop starters and text presets retain one undo step for their complete defaults", () => {
  setup();
  const id = addLibraryComponent("choice");
  assert.equal(useCapture.getState().components[0].dur, 5);
  assert.equal(useCapture.getState().sheet, null);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().components.length, 0);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().components[0].id, id);
  assert.equal(useCapture.getState().components[0].dur, 5);

  const textId = addLibraryText("Name", DEFAULT_TEXT_STYLE, 82);
  assert.equal(useCapture.getState().texts[0].y, 82);
  assert.equal(useCapture.getState().selText, textId);
  assert.equal(useCapture.getState().selComp, null);
  assert.equal(useCapture.getState().past.length, 2);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts.length, 0);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().texts[0].y, 82);
});

test("project component selection switches scene without consuming undo history", () => {
  setup();
  const sceneId = useCapture.getState().createScene();
  const id = addLibraryComponent("tooltip");
  useCapture.getState().switchScene("main");
  const history = useCapture.getState().past.length;
  selectLibraryComponent(sceneId, id);
  assert.equal(useCapture.getState().currentSceneId, sceneId);
  assert.equal(useCapture.getState().selComp, id);
  assert.equal(useCapture.getState().past.length, history);
});

test("library music clears the prior clip selection and is undoable", () => {
  setup();
  useCapture.getState().patch({ sel: 0 });
  setLibraryMusic(2);
  const state = useCapture.getState();
  assert.equal(state.sound, 2);
  assert.equal(state.sel, -1);
  assert.equal(state.sheet, "sound");
  state.undo();
  assert.equal(useCapture.getState().sound, 0);
});

test("library mutations cannot change a Try session, timeline pick or running export", () => {
  for (const patch of [
    { tryMode: { playing: false, holdingId: null, handled: [], answers: {} } },
    { playheadPick: { kind: "component-at", componentId: "example", sceneId: "main", originalT: 0 } },
    { ex: "running" },
    { recording: true },
  ]) {
    const clips = setup();
    useCapture.getState().patch(patch);
    insertLibraryClips([mkClip(2, null, 0)]);
    addLibrarySource(clips[0]);
    addLibraryComponent("choice");
    addLibraryText("Blocked", DEFAULT_TEXT_STYLE, 82);
    setLibraryMusic(2);
    const state = useCapture.getState();
    assert.deepEqual(state.clips, clips);
    assert.equal(state.components.length, 0);
    assert.equal(state.texts.length, 0);
    assert.equal(state.sound, 0);
    assert.equal(state.past.length, 0);
  }
});
