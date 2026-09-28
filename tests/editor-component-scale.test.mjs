import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { packPvoProject, readPvoProject, validatePvo } from "../packages/pvo-sdk/index.js";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { componentScale, componentSize, scaleComponentUniformly } from "./editor/src/domain/components/scale.ts";
      export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";
      export { captureCheckpoint, storeCheckpoint, restoreCheckpoint } from "./editor/src/infrastructure/projectPersistence/checkpoint.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, componentScale, componentSize, scaleComponentUniformly, buildPvoManifest,
  captureCheckpoint, storeCheckpoint, restoreCheckpoint } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function start(type = "choice") {
  const state = initial();
  const clip = mkClip(8, null, 0);
  state.scenes[0].clips = [clip];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  const id = useCapture.getState().addComponent(type);
  return { id, state: useCapture.getState() };
}

function manifest() {
  const state = useCapture.getState();
  return buildPvoManifest(state, [{ scene: state.scenes[0], assetId: "video", name: "main.webm", type: "video/webm" }]);
}

test("component scale defaults legacy and invalid values without losing bounded fractional sizes", () => {
  for (const value of [undefined, NaN, Infinity, -Infinity]) assert.equal(componentScale(value), 1);
  assert.equal(componentScale(-1), .25);
  assert.equal(componentScale(0), .25);
  assert.equal(componentScale(99), 3);
  assert.equal(componentScale(.625), .625);
});

test("scale updates preserve center, content, code ownership, and legacy absence through undo", () => {
  const { id, state } = start();
  const original = state.components[0];
  assert.equal(Object.hasOwn(original, "scale"), false);
  state.updateComponent(id, { x: 53 });
  assert.equal(Object.hasOwn(useCapture.getState().components[0], "scale"), false);
  const before = useCapture.getState();
  state.updateComponent(id, { scale: 1.75 });
  const scaled = useCapture.getState().components[0];
  assert.equal(scaled.scale, 1.75);
  assert.equal(scaled.x, 53);
  assert.equal(scaled.y, original.y);
  assert.deepEqual(scaled.fields, original.fields);
  assert.equal(scaled.code, undefined);
  assert.equal(useCapture.getState().past.length, before.past.length + 1);
  state.undo();
  assert.equal(Object.hasOwn(useCapture.getState().components[0], "scale"), false);
  state.redo();
  assert.equal(useCapture.getState().components[0].scale, 1.75);
});

test("component commands clamp size and duplication/checkpoints preserve it", () => {
  const { id, state } = start("card");
  for (const [value, expected] of [[-10, .25], [10, 3], [NaN, 1], [1.5, 1.5]]) {
    state.updateComponent(id, { scale: value });
    assert.equal(useCapture.getState().components[0].scale, expected);
  }
  const copyId = state.duplicateComponent(id);
  assert.equal(useCapture.getState().components.find(component => component.id === copyId).scale, 1.5);
  const checkpoint = storeCheckpoint(captureCheckpoint(useCapture.getState()), new Map(), 123);
  const restored = restoreCheckpoint(structuredClone(checkpoint), new Map());
  assert.deepEqual(restored.project.scenes[0].components.map(component => component.scale), [1.5, 1.5]);
  assert.equal(restored.past.at(-1).scenes[0].components[0].scale, 1.5);
});

test("export carries scale with bounded fallback dimensions and an unchanged capture center", () => {
  const { id, state } = start();
  state.updateComponent(id, { scale: .5, x: 50, y: 50 });
  let exported = manifest().components[0];
  assert.equal(exported.restyle_capture.scale, .5);
  assert.equal(exported.restyle_capture.x, 50);
  assert.equal(exported.restyle_capture.y, 50);
  assert.equal(exported.presentation.width, .355);
  assert.equal(exported.presentation.height, .2);
  assert.equal(exported.presentation.x + exported.presentation.width / 2, .5);
  assert.equal(exported.presentation.y + exported.presentation.height / 2, .5);
  state.updateComponent(id, { scale: 3 });
  exported = manifest().components[0];
  assert.equal(exported.restyle_capture.scale, 3);
  assert.equal(exported.presentation.width, 1);
  assert.equal(exported.presentation.height, 1);
  assert.equal(exported.presentation.x, 0);
  assert.equal(exported.presentation.y, 0);
  assert.deepEqual(validatePvo(manifest()).errors, []);
});

test("a packaged PVO retains size while a legacy component exports at its original size", async () => {
  const { id, state } = start("tooltip");
  const legacy = manifest().components[0];
  assert.equal(legacy.restyle_capture.scale, 1);
  assert.equal(legacy.presentation.width, .5);
  assert.equal(legacy.presentation.height, .08);
  state.updateComponent(id, { scale: 2 });
  const blob = await packPvoProject({ manifest: manifest(), assets: [
    { id: "video", name: "main.webm", blob: new Blob(["media"], { type: "video/webm" }) },
  ] });
  const decoded = await readPvoProject(blob);
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.manifest.components[0].restyle_capture.scale, 2);
});

test("independent dimensions inherit legacy scale and validate malformed values", () => {
  assert.deepEqual(componentSize(), { width: 1, height: 1 });
  assert.deepEqual(componentSize(null), { width: 1, height: 1 });
  assert.deepEqual(componentSize({ scale: 1.5, scaleX: .75 }), { width: .75, height: 1.5 });
  assert.deepEqual(componentSize({ scaleX: NaN, scaleY: "2" }), { width: 1, height: 1 });
  assert.deepEqual(componentSize({ scaleX: -2, scaleY: 5 }), { width: .25, height: 3 });
});

test("axis edits are independent, undoable, duplicated, saved and exported", async () => {
  const { id, state } = start("card");
  state.updateComponent(id, { scale: 1.5 });
  const before = structuredClone(useCapture.getState().components[0]);
  state.updateComponent(id, { scaleX: .8 });
  assert.deepEqual(componentSize(useCapture.getState().components[0]), { width: .8, height: 1.5 });
  state.undo();
  assert.deepEqual(JSON.parse(JSON.stringify(useCapture.getState().components[0])), JSON.parse(JSON.stringify(before)));
  state.redo();
  state.updateComponent(id, { scaleY: 1.2 });
  const edited = useCapture.getState().components[0];
  assert.deepEqual(JSON.parse(JSON.stringify(edited.fields)), JSON.parse(JSON.stringify(before.fields)));
  assert.deepEqual([edited.x, edited.y], [before.x, before.y]);
  const copyId = state.duplicateComponent(id);
  assert.deepEqual(componentSize(useCapture.getState().components.find(item => item.id === copyId)), { width: .8, height: 1.2 });
  const checkpoint = storeCheckpoint(captureCheckpoint(useCapture.getState()), new Map(), 123);
  const restored = restoreCheckpoint(structuredClone(checkpoint), new Map());
  assert.deepEqual(restored.project.scenes[0].components.map(componentSize), [
    { width: .8, height: 1.2 }, { width: .8, height: 1.2 },
  ]);
  const exported = manifest();
  assert.equal(exported.components[0].presentation.width, .77 * .8);
  assert.equal(exported.components[0].presentation.height, .38 * 1.2);
  const blob = await packPvoProject({ manifest: exported, assets: [
    { id: "video", name: "main.webm", blob: new Blob(["media"], { type: "video/webm" }) },
  ] });
  const decoded = await readPvoProject(blob);
  assert.equal(decoded.validation.valid, true);
  assert.deepEqual(componentSize(decoded.manifest.components[0].restyle_capture), { width: .8, height: 1.2 });
  state.updateComponent(id, { scale: 1, scaleX: undefined, scaleY: undefined });
  assert.deepEqual(componentSize(useCapture.getState().components[0]), { width: 1, height: 1 });
  state.undo();
  assert.deepEqual(componentSize(useCapture.getState().components[0]), { width: .8, height: 1.2 });
});

test("uniform gestures retain independent proportions at both limits", () => {
  const component = { scale: .25, scaleX: 1.5, scaleY: .75 };
  const enlarged = componentSize(scaleComponentUniformly(component, 3));
  assert.deepEqual(enlarged, { width: 3, height: 1.5 });
  const shrunk = componentSize(scaleComponentUniformly(component, .25));
  assert.deepEqual(shrunk, { width: .5, height: .25 });
});
