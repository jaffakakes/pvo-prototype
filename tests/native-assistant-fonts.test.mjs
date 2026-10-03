import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { parseNativeOperation, parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";

const bundled = buildSync({
  stdin: { resolveDir: process.cwd(), contents: `
    export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
    export { nativeProjectContext, nativeProjectFingerprint } from './editor/src/domain/assistant/native/context.ts';
    export { nativeExecutionContext } from './editor/src/domain/assistant/native/receipts.ts';
    export { commitNativeBatch } from './editor/src/state/assistant/nativeCommands.ts';
    export { initial } from './editor/src/state/project/initial.ts';
    export { projectSnapshot } from './editor/src/state/project/history.ts';
    export { useCapture } from './editor/src/state/captureStore.ts';
    export { useEditorPreferences } from './editor/src/state/preferences/editorPreferences.ts';
  ` }, bundle: true, write: false, format: "esm", platform: "browser",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const bytes = await readFile(new URL("../editor/src/fonts/peace-sans.woff2", import.meta.url));
const font = { id: "web-custom-font", family: "Custom Font", sourceUrl: "https://private-font.example/file", licenseUrl: "https://private-font.example/licence",
  licenseText: "Private fixture licence text", faces: [{ dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, weight: "400 700", style: "normal" }] };
const state = () => api.useCapture.getState();
const project = () => api.projectSnapshot(state());
function reset() {
  api.useCapture.setState(api.initial());
  api.useEditorPreferences.setState({ advancedEditingEnabled: false });
  state().patch({ screen: "editor", clips: [{ id: 10, url: "blob:private", srcDur: 4, in: 0, out: 4, speed: 1, color: "#000", zoom: 1, mirror: false, width: 320, height: 240, fit: "contain" }],
    components: [{ id: "note", type: "tooltip", sceneId: "main", at: 0, dur: 3, x: 50, y: 30, fields: { text: "A note" } }],
    texts: [{ id: 20, text: "A title", color: 0, start: 0, end: 3, x: 50, y: 60, style: { font: "serif", size: 30, fill: "#ff0000" } }],
    past: [], future: [],
  });
  return project();
}
function preparation(fonts = new Map([[font.id, font]])) {
  return { createId: () => 99, advancedEditingEnabled: false, fonts,
    compile: async () => { throw new Error("Applying a font must preserve the existing PVO source."); } };
}
const operation = (kind, id, fontId = font.id) => ({ kind: "font.apply", sceneId: "main", target: { kind, id }, fontId });

test("assistant applies a saved font to text and component as one independent undoable edit", async () => {
  const before = reset();
  const batch = await api.prepareNativeBatch(before, [operation("component", "note"), operation("text", 20)], preparation());
  assert.deepEqual(project(), before, "font preparation must not mutate the live project");
  assert.equal(state().past.length, 0);
  const next = batch.project.scenes[0];
  assert.deepEqual(next.components[0].fields, before.scenes[0].components[0].fields);
  assert.equal(next.texts[0].style.fill, "#ff0000");
  assert.equal(next.texts[0].style.size, 30);
  assert.equal(next.components[0].font.family, "Custom Font");
  assert.equal(next.texts[0].style.fontAsset.faces[0].dataUrl, font.faces[0].dataUrl);
  assert.ok(Object.isFrozen(next.components[0].font.faces));
  assert.equal(api.commitNativeBatch(batch, api.nativeProjectFingerprint(before), "edit"), true);
  assert.equal(state().past.length, 1);
  assert.equal(state().components[0].font.id, font.id);
  assert.equal(state().texts[0].style.fontAsset.id, font.id);
  state().undo();
  assert.deepEqual(project(), before);
  state().redo();
  assert.equal(state().texts[0].style.fontAsset.licenseText, font.licenseText);
});

test("assistant can clear downloaded typography while preserving built-in text styling", async () => {
  const before = reset();
  const applied = await api.prepareNativeBatch(before, [operation("component", "note"), operation("text", 20)], preparation());
  const removed = await api.prepareNativeBatch(applied.project, [operation("component", "note", null), operation("text", 20, null)], preparation(new Map()));
  assert.equal(removed.project.scenes[0].components[0].font, undefined);
  assert.equal(removed.project.scenes[0].texts[0].style.fontAsset, undefined);
  assert.equal(removed.project.scenes[0].texts[0].style.font, "serif");
  assert.equal(removed.project.scenes[0].texts[0].style.fill, "#ff0000");
  assert.equal(applied.project.scenes[0].components[0].font.id, font.id);
});

test("missing fonts, mismatched identities, missing targets and invalid bytes reject the entire candidate", async () => {
  const before = reset();
  const priorChange = { kind: "text.update", sceneId: "main", textId: 20, changes: { text: "Must never commit" } };
  for (const [command, fonts, message] of [
    [operation("component", "note"), new Map(), /Find and save/],
    [operation("text", 20), new Map([[font.id, { ...font, id: "different" }]]), /Find and save/],
    [operation("component", "missing"), new Map([[font.id, font]]), /existing component/],
    [operation("text", 999), new Map([[font.id, font]]), /existing text/],
    [operation("text", 20), new Map([[font.id, { ...font, faces: [{ ...font.faces[0], dataUrl: "https://remote.example/font.woff2" }] }]]), /embedded/],
  ]) await assert.rejects(api.prepareNativeBatch(before, [priorChange, command], preparation(fonts)), message);
  assert.deepEqual(project(), before);
  assert.equal(state().past.length, 0);
  assert.throws(() => parseNativeOperation({ ...operation("text", 20), font }), /unsupported/);
  assert.throws(() => parseNativeOperation(operation("clip", 10)), /unsupported/);
});

test("unfinished source drafts retain their existing font and reject an assistant replacement", async () => {
  const before = reset();
  before.scenes[0].components[0].code = { custom: true, pvoTouched: true, pvo: { structure: "<tooltip>", style: "", logic: "" } };
  await assert.rejects(api.prepareNativeBatch(before, [operation("component", "note")], preparation()), /Finish or discard/);
  assert.equal(before.scenes[0].components[0].font, undefined);
});

test("assistant context and execution receipts carry only font identity summaries", async () => {
  const before = reset();
  const batch = await api.prepareNativeBatch(before, [operation("component", "note"), operation("text", 20)], preparation());
  const context = api.nativeProjectContext(batch.project, 0);
  const execution = api.nativeExecutionContext(before, batch.receipts);
  const expected = { id: font.id, family: font.family };
  assert.deepEqual(context.scenes[0].components[0].font, expected);
  assert.deepEqual(context.scenes[0].texts[0].font, expected);
  assert.equal(context.scenes[0].texts[0].style.fontAsset, undefined);
  assert.deepEqual(batch.receipts.map(receipt => receipt.outcome), ["prepared", "prepared"]);
  const serialized = JSON.stringify({ context, execution });
  assert.doesNotMatch(serialized, /data:font|base64|private-font|Private fixture|licenseText|fontAsset/);
  assert.ok(serialized.length < 12000, "font bytes must not consume assistant context budget");
  assert.doesNotThrow(() => parseNativeTurnRequest({ mode: "edit", prompt: "Apply the saved font", history: [], observations: [], project: context, execution }));
});
