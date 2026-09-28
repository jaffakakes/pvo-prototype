import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { canvasPixelSize, componentPixelDimension, componentPixelSize, componentPixelTransform } from "../packages/pvo-component-runtime/index.js";
import { packPvoProject, readPvoProject } from "../packages/pvo-sdk/index.js";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { resizeComponentPixels } from "./editor/src/domain/components/pixelSize.ts";
      export { beginOverlayTransform } from "./editor/src/state/editing/overlayTransform.ts";
      export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";
      export { captureCheckpoint, storeCheckpoint, restoreCheckpoint } from "./editor/src/infrastructure/projectPersistence/checkpoint.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, resizeComponentPixels, beginOverlayTransform, buildPvoManifest,
  captureCheckpoint, storeCheckpoint, restoreCheckpoint } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function start() {
  const state = initial();
  state.scenes[0].clips = [mkClip(8, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  const id = useCapture.getState().addComponent("card");
  return { id, state: useCapture.getState() };
}

const component = () => useCapture.getState().components[0];
const natural = { width: 600, height: 200 };
const json = value => JSON.parse(JSON.stringify(value));

test("canvas pixels have a fixed short edge across all project ratios", () => {
  assert.deepEqual(canvasPixelSize(9, 16), { width: 1080, height: 1920 });
  assert.deepEqual(canvasPixelSize(16, 9), { width: 1920, height: 1080 });
  assert.deepEqual(canvasPixelSize(1, 1), { width: 1080, height: 1080 });
  assert.deepEqual(canvasPixelSize(4, 5), { width: 1080, height: 1350 });
  assert.deepEqual(canvasPixelSize(NaN, 0), { width: 1080, height: 1920 });
});

test("pixel dimensions validate inputs and retain legacy component sizes", () => {
  for (const value of [undefined, null, NaN, Infinity, "300"]) assert.equal(componentPixelDimension(value), undefined);
  assert.equal(componentPixelDimension(-10), 1);
  assert.equal(componentPixelDimension(20000), 16384);
  assert.equal(componentPixelDimension(320.5), 320.5);
  assert.deepEqual(componentPixelSize({ scale: 1.5 }, natural), { width: 900, height: 300 });
  assert.deepEqual(componentPixelSize({ scale: 1.5, scaleX: .5 }, natural), { width: 300, height: 300 });
  assert.deepEqual(componentPixelSize({ width: 320, height: 180, scale: 1.5 }, natural), { width: 480, height: 270 });
  assert.deepEqual(componentPixelTransform({ width: 300, height: 100 }, natural), { width: .5, height: .5 });
});

test("editing pixels retains the other axis, survives content reflow and is undoable", () => {
  const { id, state } = start();
  state.updateComponent(id, { scale: 1.5, scaleX: .8, scaleY: 1.2 });
  const before = json(component());
  state.updateComponent(id, resizeComponentPixels(component(), natural, "width", 320));
  assert.deepEqual(componentPixelSize(component(), natural), { width: 320, height: 240 });
  assert.deepEqual(componentPixelSize(component(), { width: 800, height: 500 }), { width: 320, height: 240 });
  assert.deepEqual(json(component().fields), before.fields);
  state.undo();
  assert.deepEqual(json(component()), before);
  state.redo();
  state.updateComponent(id, resizeComponentPixels(component(), natural, "height", 180));
  assert.deepEqual(componentPixelSize(component(), natural), { width: 320, height: 180 });
  const copy = state.duplicateComponent(id);
  assert.deepEqual(componentPixelSize(useCapture.getState().components.find(item => item.id === copy), natural), { width: 320, height: 180 });
  const checkpoint = storeCheckpoint(captureCheckpoint(useCapture.getState()), new Map(), 123);
  const restored = restoreCheckpoint(structuredClone(checkpoint), new Map());
  assert.deepEqual(componentPixelSize(restored.project.scenes[0].components[0], natural), { width: 320, height: 180 });
});

test("pixel sizes preserve proportional pinch, cancellation and history", () => {
  const { id, state } = start();
  state.updateComponent(id, { width: 300, height: 160 });
  const before = json(component());
  let gesture = beginOverlayTransform({ kind: "component", id });
  gesture.update({ ...gesture.value(), size: 1.5 });
  assert.deepEqual(componentPixelSize(component(), natural), { width: 450, height: 240 });
  gesture.cancel();
  assert.deepEqual(json(component()), before);
  gesture = beginOverlayTransform({ kind: "component", id });
  gesture.update({ ...gesture.value(), size: .5 });
  gesture.commit();
  state.undo();
  assert.deepEqual(json(component()), before);
  state.redo();
  assert.deepEqual(componentPixelSize(component(), natural), { width: 150, height: 80 });
});

test("a partial pixel override does not jump when moved beside legacy axis scales", () => {
  const { id, state } = start();
  state.updateComponent(id, { width: 300, scale: 1.5, scaleX: .8, scaleY: 1.2 });
  const before = componentPixelSize(component(), natural);
  const gesture = beginOverlayTransform({ kind: "component", id });
  gesture.update({ ...gesture.value(), x: 60 });
  assert.deepEqual(componentPixelSize(component(), natural), before);
  gesture.update({ ...gesture.value(), size: 1.8 });
  const size = componentPixelSize(component(), natural);
  assert(Math.abs(size.width - before.width * 1.2) < 1e-10);
  assert(Math.abs(size.height - before.height * 1.2) < 1e-10);
  gesture.cancel();
  assert.deepEqual(componentPixelSize(component(), natural), before);
});

test("PVO retains pixels and its fallback rectangle uses the actual canvas dimensions", async () => {
  const { id, state } = start();
  state.updateComponent(id, { width: 300, height: 160, scale: 1.5 });
  for (const [ratio, width, height] of [["9:16", 1080, 1920], ["16:9", 1920, 1080]]) {
    state.patch({ ratio });
    const current = useCapture.getState();
    const manifest = buildPvoManifest(current, [{ scene: current.scenes[0], assetId: "video", name: "main.webm", type: "video/webm" }]);
    assert.equal(manifest.components[0].presentation.width, 450 / width);
    assert.equal(manifest.components[0].presentation.height, 240 / height);
    const blob = await packPvoProject({ manifest, assets: [
      { id: "video", name: "main.webm", blob: new Blob(["media"], { type: "video/webm" }) },
    ] });
    const decoded = await readPvoProject(blob);
    assert.equal(decoded.validation.valid, true);
    assert.deepEqual(componentPixelSize(decoded.manifest.components[0].restyle_capture, natural), { width: 450, height: 240 });
  }
});
