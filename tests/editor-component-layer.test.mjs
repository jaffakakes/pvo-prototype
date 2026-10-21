import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { componentLayerMotion } from "../packages/pvo-component-runtime/index.js";
import { createComponentMotion } from "../player/components/motion.js";
const bundled = buildSync({
  stdin: {
    contents: `export * from './editor/src/store.ts'; export * from './editor/src/state/components/componentLayerGesture.ts'; export * from './editor/src/state/components/componentLayerCommands.ts'; export * from './editor/src/domain/export/manifest.ts'; export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  useCapture,
  mkClip,
  beginComponentLayerGesture,
  selectComponentLayer,
  buildPvoManifest,
  captureCheckpoint,
  storeCheckpoint,
  restoreCheckpoint,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
function fixture(type = "form") {
  const clip = mkClip(8, null, 0);
  const scene = {
    id: "main",
    name: "Main",
    parent: null,
    clips: [clip],
    texts: [],
    components: [],
    muted: true,
    sound: 0,
    layers: ["video"],
  };
  useCapture.setState({
    localId: "layer-test",
    scenes: [scene],
    currentSceneId: "main",
    clips: [clip],
    components: [],
    texts: [],
    audioClips: [],
    layers: ["video"],
    sel: -1,
    selText: null,
    selAudio: null,
    selComp: null,
    t: 1,
    past: [],
    future: [],
    tryMode: null,
    playheadPick: null,
    sheet: null,
    playing: false,
    ratio: "9:16",
    allowedDomains: [],
  });
  return useCapture.getState().addComponent(type);
}
const selected = () =>
  useCapture
    .getState()
    .components.find((c) => c.id === useCapture.getState().selComp);
test("add and select retain the video workspace; duplicate is half a second later and one Undo", () => {
  const id = fixture();
  assert.equal(useCapture.getState().sheet, null);
  useCapture.getState().patch({ playing: true });
  selectComponentLayer(id);
  assert.equal(useCapture.getState().playing, true);
  const before = useCapture.getState().past.length;
  const copy = useCapture.getState().duplicateComponent(id);
  assert.equal(selected().id, copy);
  assert.equal(selected().at, 1.5);
  assert.equal(useCapture.getState().past.length, before + 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().components.length, 1);
});
test("appearance gesture previews live, preserves playing and code, and commits one Undo", () => {
  const id = fixture();
  const code = {
    custom: true,
    pvoTouched: true,
    pvo: { structure: "unfinished", style: "draft", logic: "draft" },
  };
  useCapture.getState().updateComponent(id, { code });
  useCapture.getState().patch({ past: [], future: [], playing: true });
  const edit = beginComponentLayerGesture(id);
  edit.update({ opacity: 0.4 });
  edit.update({ opacity: 0.8, rotation: 20 });
  assert.equal(useCapture.getState().past.length, 0);
  assert.equal(useCapture.getState().playing, true);
  assert.deepEqual(JSON.parse(JSON.stringify(selected().code)), code);
  edit.commit();
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(selected().opacity, undefined);
  assert.equal(selected().rotation, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(selected().code)), code);
  useCapture.getState().redo();
  assert.equal(selected().opacity, 0.8);
});
test("cancel and stale gestures never write over a newer edit or a different project", () => {
  const id = fixture();
  const edit = beginComponentLayerGesture(id);
  edit.update({ opacity: 0.2 });
  edit.cancel();
  assert.equal(selected().opacity, undefined);
  const next = beginComponentLayerGesture(id);
  next.update({ opacity: 0.3 });
  useCapture.getState().updateComponent(id, { opacity: 0.9 });
  next.cancel();
  assert.equal(selected().opacity, 0.9);
  const stale = beginComponentLayerGesture(id);
  useCapture.getState().patch({ localId: "another" });
  assert.equal(stale.update({ opacity: 0 }), false);
});
test("layer values are bounded and static motion composes with animation", () => {
  const id = fixture();
  useCapture
    .getState()
    .updateComponent(id, { opacity: 5, rotation: -100, dur: 0.1 });
  assert.equal(selected().opacity, 1);
  assert.equal(selected().rotation, -45);
  assert.equal(selected().dur, 0.5);
  useCapture
    .getState()
    .updateComponent(id, { opacity: NaN, rotation: Infinity });
  assert.equal(selected().opacity, 1);
  assert.equal(selected().rotation, 0);
  assert.deepEqual(
    componentLayerMotion(
      { opacity: 0.8, rotation: 20 },
      { opacity: 0.5, rotation: 10, x: 2 },
    ),
    { opacity: 0.4, rotation: 30, x: 2 },
  );
});
test("interactive export and viewer wrapper preserve opacity and rotation", () => {
  const id = fixture("card");
  useCapture.getState().updateComponent(id, { opacity: 0.6, rotation: 25 });
  const s = useCapture.getState();
  const manifest = buildPvoManifest(s, [
    {
      scene: s.scenes[0],
      assetId: "video",
      name: "main.mp4",
      type: "video/mp4",
    },
  ]);
  const c = manifest.components.find((c) => c.id === id);
  assert.equal(c.restyle_capture.opacity, 0.6);
  assert.equal(c.restyle_capture.rotation, 25);
  const position = { style: {} };
  const runtime = createComponentMotion(position, c, {
    manifest,
    elapsedTime: () => 1.5,
  });
  assert.equal(position.style.opacity, "0.6");
  assert.match(position.style.transform, /rotate\(25deg\)/);
  runtime.dispose();
});

test("checkpoint restore retains layer appearance and reversible history", () => {
  const id = fixture();
  useCapture
    .getState()
    .updateComponent(id, { opacity: 0.55, rotation: -12, scale: 1.4 });
  const stored = storeCheckpoint(
    captureCheckpoint(useCapture.getState()),
    new Map(),
    123,
  );
  const restored = restoreCheckpoint(
    JSON.parse(JSON.stringify(stored)),
    new Map(),
  );
  const c = restored.project.scenes[0].components[0];
  assert.equal(c.opacity, 0.55);
  assert.equal(c.rotation, -12);
  assert.equal(c.scale, 1.4);
  assert.equal(restored.past.at(-1).scenes[0].components[0].opacity, undefined);
});
