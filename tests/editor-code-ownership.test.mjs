import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: { contents: `export * from './editor/src/domain/components/codeOwnership.ts';
    export { editComponentAction, editComponentWaitingLabel } from './editor/src/domain/components/languageActionEditing.ts';
    export { useCapture } from './editor/src/state/captureStore.ts';
    export { createRoutedScene } from './editor/src/state/scenes/sceneRoutingCommands.ts';
    export { cloneComponent } from './editor/src/domain/project/snapshot.ts';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { isCodeOwned, isVisualEditingBlocked, beginPvoEdit, restoreLastValidPvo, takeOverWithCode, returnToVisualEditing, cloneComponent, editComponentAction, editComponentWaitingLabel, useCapture, createRoutedScene } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fixture() {
  return {
    id: "message", type: "card", sceneId: "main", at: 4, dur: 5, x: 50, y: 60,
    fields: { title: "Hello", body: "A message", buttons: [{ label: "Next", outcome: { kind: "time", t: 8 } }] },
  };
}

test("code takeover uses generated content, preserves routing and leaves visual settings intact", () => {
  const before = fixture();
  const patch = takeOverWithCode(before);
  const after = { ...before, ...patch };
  assert(isCodeOwned(after));
  assert.equal(after.fields, before.fields);
  assert.equal(after.at, 4);
  assert.match(after.code.pvo.structure, /Hello/);
  assert.match(after.code.pvo.logic, /jump_to\(8\)/);
});

test("returning to visual editing archives exact code and restores it independently of visual edits", () => {
  const original = { ...fixture(), code: {
    custom: true, pvoLiteral: true, pvoTouched: true,
    pvo: { structure: "<card><title>Keep this draft</title></card>", style: "card { color: #FFF; }", logic: "" },
  } };
  const visual = { ...original, ...returnToVisualEditing(original) };
  assert.equal(isCodeOwned(visual), false);
  assert.equal(visual.look.preset, "bold");
  assert.deepEqual(visual.archivedCode, original.code);
  assert.notEqual(visual.archivedCode, original.code);
  const snapshot = cloneComponent(visual);
  visual.archivedCode.pvo.style = "changed";
  assert.equal(snapshot.archivedCode.pvo.style, original.code.pvo.style);
  const restored = { ...snapshot, ...takeOverWithCode(snapshot, true) };
  assert.deepEqual(restored.code, original.code);
});

test("editing actions beside an invalid style preserves drafts and only changes the chosen event", () => {
  const original = { ...fixture(), code: {
    custom: true, pvoLiteral: true, pvoTouched: true,
    pvo: {
      structure: "<card><title>Hello</title><button id=\"go\">Next</button><button id=\"stay\">Stay</button></card>",
      style: "card { color: invalid draft",
      logic: 'on press(go) { request({"url":"https://example.com/x","body":"} on press(stay) {","method":"GET","onSuccess":{"kind":"continue"},"onError":null}); }\non press(stay) { a_draft(); }',
    },
    pvoCompiled: { structure: { type: "card", title: "Hello", body: "A message", buttons: [{ id: "go", label: "Next" }, { id: "stay", label: "Stay" }] },
      rules: [{ event: "press", target: "go", action: { kind: "continue" } }, { event: "press", target: "stay", action: { kind: "continue" } }] },
  } };
  const outcome = { kind: "time", t: 9 };
  const fields = { ...original.fields, buttons: [{ label: "Next", outcome }, { label: "Stay", outcome: { kind: "continue" } }] };
  const patch = editComponentAction(original, fields, { kind: "button", index: 0 }, outcome);
  assert.equal(patch.code.pvo.style, original.code.pvo.style);
  assert.equal(patch.code.pvo.structure, original.code.pvo.structure);
  assert.match(patch.code.pvo.logic, /on press\(go\) \{\n  jump_to\(9\);\n\}/);
  assert(patch.code.pvo.logic.endsWith("on press(stay) { a_draft(); }"));
  assert.deepEqual(patch.code.pvoCompiled.rules[0].action, outcome);
  assert.equal(patch.code.pvoTouched, true);
  original.code.pvo.logic = "on press(go) { incomplete";
  assert.equal(editComponentAction(original, fields, { kind: "button", index: 0 }, outcome), null);
});

test("an uneditable draft cannot create an unconnected scene or consume an undo entry", () => {
  const component = { ...fixture(), code: {
    custom: true, pvoLiteral: true, pvoTouched: true,
    pvo: { structure: "<card><button id=\"button0\">Next</button></card>", style: "", logic: "on press(button0) { unfinished" },
  } };
  const scene = { id: "main", name: "Main", parent: null, clips: [], texts: [], components: [component], muted: false, sound: 0 };
  useCapture.getState().patch({ scenes: [scene], currentSceneId: "main", screen: "editor", sheet: "component", selComp: component.id, past: [], future: [] });
  assert.equal(createRoutedScene(component.id, { kind: "button", index: 0 }), null);
  assert.equal(createRoutedScene(component.id, { kind: "button", index: 0 }, undefined, { openCamera: false }), null);
  const after = useCapture.getState();
  assert.equal(after.scenes.length, 1);
  assert.equal(after.past.length, 0);
  assert.equal(after.sheet, "component");
  assert.equal(after.selComp, component.id);
});

test("a waiting-label edit targets the submit tag while preserving other malformed drafts", () => {
  const component = { ...fixture(), type: "form", fields: { fieldKinds: ["email"], submitLabel: "Join", waitingLabel: "Sending…" }, code: {
    custom: true, pvoLiteral: true, pvoTouched: true,
    pvo: { structure: '<form><heading>Unclosed draft<field name="email" kind="email"/><submit waiting="Sending…">Join</submit></form>',
      style: "form { color: invalid draft", logic: "on submit { unfinished" },
  } };
  const patch = editComponentWaitingLabel(component, 'Please "wait" >');
  assert.equal(patch.fields.waitingLabel, 'Please "wait" >');
  assert.equal(patch.code.pvoTouched, true);
  assert.equal(patch.code.pvo.style, component.code.pvo.style);
  assert.equal(patch.code.pvo.logic, component.code.pvo.logic);
  assert.equal(patch.code.pvo.structure, component.code.pvo.structure.replace('waiting="Sending…"', 'waiting="Please &quot;wait&quot; &gt;"'));
  for (const opening of ['<submit waiting="unfinished>', '<submit unexpected="x">', '<submit/>']) {
    const broken = { ...component, code: { ...component.code,
      pvo: { ...component.code.pvo, structure: `<form>${opening}Join</submit></form>` } } };
    assert.equal(editComponentWaitingLabel(broken, "Waiting…"), null);
  }
});

test("Advanced begins directly with a recoverable source and only unfinished drafts block visual edits", () => {
  const original = fixture();
  const draft = { ...original, ...beginPvoEdit(original, "structure", "<card><title>Unfinished") };
  assert.equal(isVisualEditingBlocked(original), false);
  assert.equal(isVisualEditingBlocked(draft), true);
  assert.match(draft.code.pvoLastValid.structure, /Hello/);
  assert.equal(draft.fields, original.fields);
  const saved = cloneComponent(draft);
  draft.code.pvoLastValid.structure = "changed";
  const restored = restoreLastValidPvo(saved);
  assert.match(restored.code.pvo.structure, /Hello/);
  assert.equal(restored.code.pvoTouched, true);
  assert.equal(saved.code.pvo.structure, "<card><title>Unfinished");
  const accepted = { ...saved, code: { ...restored.code, pvoTouched: false, pvoCompiled: {
    structure: { type: "card", title: "Hello", body: "A message", buttons: [{ id: "button0", label: "Next" }] },
    rules: [{ event: "press", target: "button0", action: { kind: "time", t: 8 } }],
  } } };
  assert.equal(isCodeOwned(accepted), true);
  assert.equal(isVisualEditingBlocked(accepted), false);
  const pending = { ...accepted, ...beginPvoEdit(accepted, "style", "card { invalid") };
  const outcome = { kind: "time", t: 9 };
  const patch = editComponentAction(pending, { ...pending.fields, buttons: [{ label: "Next", outcome }] }, { kind: "button", index: 0 }, outcome);
  assert.equal(patch.code.pvo.style, "card { invalid");
  assert.match(patch.code.pvoLastValid.logic, /jump_to\(9\)/);
  assert.doesNotMatch(patch.code.pvoLastValid.style, /invalid/);
});
