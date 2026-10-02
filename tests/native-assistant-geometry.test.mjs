import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { parseNativeOperation, parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
  export { nativeProjectContext } from './editor/src/domain/assistant/native/context.ts';
  export { scaleComponentUniformly } from './editor/src/domain/components/scale.ts';
  export { componentEnd } from './editor/src/domain/components/timing.ts';
  export { commitNativeBatch } from './editor/src/state/assistant/nativeCommands.ts';
  export { nativeProjectFingerprint } from './editor/src/domain/assistant/native/context.ts';
  export { componentSize, componentPixelSize } from './packages/pvo-component-runtime/index.js';
  export { initial } from './editor/src/state/project/initial.ts';
  export { projectSnapshot } from './editor/src/state/project/history.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function fixture(changes = {}) {
  api.useCapture.setState(api.initial());
  const state = api.useCapture.getState();
  state.patch({ screen: "editor", clips: [{ id: 1, url: "blob:private", srcDur: 12, in: 0, out: 12,
    speed: 1, zoom: 1, mirror: false, fit: "contain", width: 640, height: 480, color: "#000" }] });
  const id = state.addComponent("tooltip");
  state.updateComponent(id, changes);
  return { project: api.projectSnapshot(api.useCapture.getState()), id };
}
const options = { createId: () => 100, advancedEditingEnabled: false,
  compile: async () => { throw new Error("Geometry changes must not rewrite or compile component source"); } };
const component = project => project.scenes[0].components[0];
const update = (id, changes) => ({ kind: "component.update", sceneId: "main", componentId: id, changes });

test("native uniform scaling matches manual pinch for independent axes instead of silently preserving the old size", async () => {
  const { project, id } = fixture({ scale: 1, scaleX: 0.5, scaleY: 2 });
  const before = component(project);
  const manualChanges = api.scaleComponentUniformly(before, 1.5);
  api.useCapture.getState().updateComponent(id, manualChanges);
  const manual = component(api.projectSnapshot(api.useCapture.getState()));
  const batch = await api.prepareNativeBatch(project, [update(id, { scale: 1.5 })], options);
  const native = component(batch.project);
  assert.deepEqual(api.componentSize(native), api.componentSize(manual));
  assert.deepEqual(api.componentSize(native), { width: 0.75, height: 3 });
  assert.deepEqual(component(project), before, "Preparing the new geometry preserves the original snapshot");
});

test("authored pixel dimensions and axis edits preserve unrelated fields and one-step Undo", async () => {
  const { project, id } = fixture({ x: 28, y: 72, scale: 1.5, scaleX: 0.75, scaleY: 2 });
  const before = component(project);
  const batch = await api.prepareNativeBatch(project, [update(id, { width: 600, height: 300, scaleX: 0.5, scaleY: 2.5 })], options);
  const actual = component(batch.project);
  assert.deepEqual([actual.width, actual.height, actual.scaleX, actual.scaleY], [600, 300, 0.5, 2.5]);
  assert.deepEqual([actual.x, actual.y, actual.scale, actual.at, actual.dur], [before.x, before.y, before.scale, before.at, before.dur]);
  assert.deepEqual(actual.fields, before.fields);
  assert.deepEqual(actual.code, before.code);
  assert.deepEqual(api.componentPixelSize(actual, { width: 100, height: 50 }), { width: 900, height: 450 },
    "Authored pixel sizes use the current uniform multiplier, independently of axis overrides");
  const oldHistory = api.useCapture.getState().past.length;
  api.commitNativeBatch(batch, api.nativeProjectFingerprint(project), "edit");
  assert.equal(api.useCapture.getState().past.length, oldHistory + 1);
  api.useCapture.getState().undo();
  assert.deepEqual(api.projectSnapshot(api.useCapture.getState()), project);
});

test("reset clears explicit dimensions and axis overrides before applying normal scale limits", async () => {
  const { project, id } = fixture({ width: 16000, height: 300, scale: 2, scaleX: 0.25, scaleY: 3 });
  const changes = { width: null, height: null, scaleX: null, scaleY: null, scale: 1 };
  const batch = await api.prepareNativeBatch(project, [update(id, changes)], options);
  const actual = component(batch.project);
  api.useCapture.getState().updateComponent(id, { width: undefined, height: undefined, scaleX: undefined, scaleY: undefined, scale: 1 });
  const manual = component(api.projectSnapshot(api.useCapture.getState()));
  assert.deepEqual(actual, manual);
  assert.deepEqual(api.componentSize(actual), { width: 1, height: 1 });
  assert.deepEqual(api.componentPixelSize(actual, { width: 140, height: 70 }), { width: 140, height: 70 });
});

test("one-axis authored pixel edits leave the other authored axis and scale unchanged", async () => {
  const { project, id } = fixture({ width: 500, scale: 1.25, scaleY: 2 });
  const batch = await api.prepareNativeBatch(project, [update(id, { width: 700 })], options);
  const actual = component(batch.project);
  assert.equal(actual.width, 700);
  assert.equal(actual.height, undefined);
  assert.equal(actual.scale, 1.25);
  assert.equal(actual.scaleY, 2);
  assert.equal(api.componentPixelSize(actual, { width: 100, height: 80 }).height, 160,
    "This does not pretend to know or overwrite the other intrinsic dimension");
});

test("null component duration retains until-clip-end behavior after subsequent source trimming", async () => {
  const { project, id } = fixture({ at: 1, dur: 3 });
  const batch = await api.prepareNativeBatch(project, [update(id, { duration: null }),
    { kind: "clip.trim", sceneId: "main", clipId: 1, sourceIn: 0, sourceOut: 8 }], options);
  const actual = component(batch.project);
  assert.equal(actual.dur, null);
  assert.equal(api.componentEnd(actual, batch.project.scenes[0].clips), 8);
  assert.equal(api.nativeProjectContext(batch.project, 0).scenes[0].components[0].duration, null);
  assert.doesNotThrow(() => parseNativeOperation({ kind: "component.add", sceneId: "main", componentType: "tooltip", at: 0, duration: null }));
});

test("context exposes authored geometry, resolved scales and canvas pixels without inventing rendered bounds", () => {
  const { project } = fixture({ scaleX: 0.5, scaleY: 2 });
  const context = api.nativeProjectContext(project, 1);
  assert.deepEqual(context.canvas, { width: 1080, height: 1920 });
  const actual = context.scenes[0].components[0];
  assert.deepEqual([actual.scale, actual.scaleX, actual.scaleY, actual.proportionalScale, actual.width, actual.height],
    [1, 0.5, 2, 1, null, null]);
  assert.equal(actual.renderedWidth, undefined);
  assert.equal(actual.renderedHeight, undefined);
  assert.doesNotMatch(JSON.stringify(context), /blob:private/);
  assert.doesNotThrow(() => parseNativeTurnRequest({ mode: "ask", prompt: "What size is this?", history: [], observations: [], project: context }));
});

test("geometry contract rejects out-of-range values and incomplete context while permitting explicit resets", () => {
  for (const changes of [{ width: 0 }, { height: 16385 }, { width: Infinity }, { scaleX: 0.2 }, { scaleY: 4 },
    { scale: null }, { duration: -1 }, { duration: 0.1 }]) {
    assert.throws(() => parseNativeOperation(update("component", changes)), /range|shape|must be/);
  }
  assert.deepEqual(parseNativeOperation(update("component", { width: null, height: null, scaleX: null, scaleY: null, duration: null })),
    update("component", { width: null, height: null, scaleX: null, scaleY: null, duration: null }));
  const { project } = fixture();
  const context = api.nativeProjectContext(project, 0);
  delete context.scenes[0].components[0].scaleX;
  assert.throws(() => parseNativeTurnRequest({ mode: "ask", prompt: "Size?", history: [], observations: [], project: context }), /scaleX is required/);
});
