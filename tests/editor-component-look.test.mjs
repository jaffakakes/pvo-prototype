import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createLook, lookStyles, normalizeLook } from "../packages/pvo-component-runtime/index.js";
import { packPvoProject, readPvoProject } from "../packages/pvo-sdk/index.js";

const bundled = buildSync({
  stdin: { contents: `
    export { useCapture, mkClip } from "./editor/src/store.ts";
    export { initial } from "./editor/src/state/project/initial.ts";
    export { applyComponentPreset, componentLook, resetComponentLook } from "./editor/src/domain/components/look.ts";
    export { cloneComponent } from "./editor/src/domain/project/snapshot.ts";
    export { componentLanguageSource } from "./editor/src/domain/components/languageCompilation.ts";
    export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";
    export { captureCheckpoint, storeCheckpoint, restoreCheckpoint } from "./editor/src/infrastructure/projectPersistence/checkpoint.ts";
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, applyComponentPreset, componentLook, resetComponentLook,
  cloneComponent, componentLanguageSource, buildPvoManifest, captureCheckpoint, storeCheckpoint, restoreCheckpoint } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function start(type = "choice") {
  const state = initial();
  state.scenes[0].clips = [mkClip(10, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  const id = useCapture.getState().addComponent(type);
  return { id, state: useCapture.getState() };
}

test("preset changes only appearance and undo restores independent per-button edits", () => {
  const { id, state } = start();
  state.updateComponent(id, { x: 39, y: 71, at: 4, fields: {
    prompt: "Which look?", options: [{ label: "Street", outcome: { kind: "time", t: 7 } }, { label: "Evening", outcome: { kind: "continue" } }],
  } });
  const before = structuredClone(useCapture.getState().components[0]);
  for (const preset of ["soft", "minimal", "contrast", "bold"]) {
    state.updateComponent(id, { look: applyComponentPreset(before, preset) });
    const { look, ...content } = useCapture.getState().components[0];
    const { look: oldLook, ...original } = before;
    assert.deepEqual(content, original);
    assert.equal(look.basePreset, preset);
  }
  const look = componentLook(useCapture.getState().components[0]);
  look.btns[1].fill = "#00E5A0";
  state.updateComponent(id, { look });
  assert.equal(useCapture.getState().components[0].look.btns[0].fill, "#FF9FBC");
  state.undo();
  assert.equal(useCapture.getState().components[0].look.btns[1].fill, "#FF9FBC");
  state.redo();
  assert.equal(useCapture.getState().components[0].look.btns[1].fill, "#00E5A0");
});

test("reset remembers the selected base after customization, and clones do not share appearance", () => {
  const { state } = start("card");
  const component = state.components[0];
  component.look = applyComponentPreset(component, "soft");
  component.look.preset = "custom";
  component.look.whole.bg = "#5B8DEF";
  const copy = cloneComponent(component);
  copy.look.whole.bg = "#00E5A0";
  copy.look.btns[0].text = "#000000";
  assert.equal(component.look.whole.bg, "#5B8DEF");
  assert.equal(component.look.btns[0].text, "#15151C");
  assert.deepEqual(resetComponentLook(component), createLook("soft", 1));
});

test("checkpoint, duplication and interactive packaging preserve custom appearance", async () => {
  const { id, state } = start();
  const look = createLook("minimal", 2);
  look.btns[0].text = "#FF9FBC";
  state.updateComponent(id, { look });
  const copyId = state.duplicateComponent(id);
  assert.deepEqual(useCapture.getState().components.find(component => component.id === copyId).look, look);
  const checkpoint = storeCheckpoint(captureCheckpoint(useCapture.getState()), new Map(), 123);
  const restored = restoreCheckpoint(structuredClone(checkpoint), new Map());
  assert.deepEqual(restored.project.scenes[0].components[0].look, look);
  const scene = useCapture.getState().scenes[0];
  const manifest = buildPvoManifest(useCapture.getState(), [{ scene, assetId: "media", name: "main.webm", type: "video/webm" }]);
  const blob = await packPvoProject({ manifest, assets: [{ id: "media", name: "main.webm", blob: new Blob(["video"], { type: "video/webm" }) }] });
  const decoded = await readPvoProject(blob);
  assert.equal(decoded.validation.valid, true);
  assert.deepEqual(decoded.manifest.components[0].restyle_capture.look, look);
  assert.equal(decoded.manifest.components[0].restyle_capture.code, undefined);
});

test("visual export keeps native appearance even when generated language is available", () => {
  const { state } = start("choice");
  const component = state.components[0];
  const generated = { source: componentLanguageSource(component), compiled: {
    structure: { type: "choice", prompt: "Old prompt", options: [{ id: "option0", label: "Old one" }, { id: "option1", label: "Old two" }] },
    rules: [{ target: "option0", action: { kind: "continue" } }, { target: "option1", action: { kind: "continue" } }],
  } };
  const manifest = buildPvoManifest(state, [{ scene: state.scenes[0], assetId: "media", name: "main.webm", type: "video/webm" }], new Map([[component.id, generated]]));
  assert.equal(manifest.components[0].title, component.fields.prompt);
  assert.equal(manifest.components[0].restyle_capture.code, undefined);
  assert.match(generated.source.style, /#option0/);
  assert.match(generated.source.style, /background: #FF9FBC/);
});

test("legacy absence stays absent until editing, and serialized style values are bounded", () => {
  const { state } = start("tooltip");
  const legacy = { ...state.components[0] };
  delete legacy.look;
  assert.equal(Object.hasOwn(cloneComponent(legacy), "look"), false);
  assert.equal(componentLook(legacy).preset, "bold");
  const malicious = normalizeLook({ whole: { bg: "url(https://invalid.test)", radius: 99999 }, body: { size: "XXXL", weight: 1 }, btns: [{ fill: "red; position:fixed" }] });
  assert.equal(malicious.whole.bg, "#15151C");
  assert.equal(malicious.whole.radius, 14);
  assert.equal(malicious.body.size, "M");
  assert.equal(malicious.btns[0].fill, "#FF9FBC");
  const scaled = lookStyles(createLook("contrast", 1), 2, 1);
  assert.equal(scaled.heading.fontSize, "40px");
  assert.equal(scaled.buttons[0].minHeight, "68px");
});
