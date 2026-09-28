import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { projectSnapshot } from "./editor/src/state/project/history.ts";
      export { acceptComponentCompilation } from "./editor/src/state/components/componentLanguageCommands.ts";
      export { componentLanguageSource, resolveLanguageSource } from "./editor/src/domain/components/languageCompilation.ts";
      export { fieldsShownFor } from "./editor/src/domain/components/fields.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, projectSnapshot, acceptComponentCompilation,
  componentLanguageSource, resolveLanguageSource, fieldsShownFor } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const continuing = { kind: "continue" };
const plain = value => JSON.parse(JSON.stringify(value));
const find = id => useCapture.getState().scenes.flatMap(scene => scene.components).find(component => component.id === id);
const saved = () => structuredClone({ project: projectSnapshot(useCapture.getState()), past: useCapture.getState().past, future: useCapture.getState().future });

function start(type = "card") {
  const state = initial();
  state.scenes[0].clips = [mkClip(8, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  const id = useCapture.getState().addComponent(type);
  return find(id);
}

function openAdvanced(id) {
  const component = find(id);
  useCapture.getState().updateComponent(id, {
    code: { custom: false, pvoLiteral: true, pvo: componentLanguageSource(component) },
  }, false);
  return find(id);
}

function compiledCard(title = "Authored", action = { kind: "time", t: 4 }) {
  return {
    structure: { type: "card", title, body: "Details", buttons: [{ id: "learn", label: "Explore" }] },
    rules: [{ event: "press", target: "learn", action }], html: "", css: "", js: "",
  };
}

function authorCard() {
  const component = start();
  const opened = openAdvanced(component.id);
  useCapture.getState().updateComponent(component.id, { code: {
    ...opened.code, pvoTouched: true,
    pvo: {
      structure: '<card><title>Authored</title><body>Details</body><button id="learn">Explore</button></card>',
      style: "#learn { background: #abc; }\ncard { color: #123; }",
      logic: "on press(learn) { jump_to(4); }",
    },
  } });
  acceptComponentCompilation(find(component.id), compiledCard());
  return find(component.id);
}

test("Fields commands update the visible Advanced starter without claiming custom ownership", () => {
  const original = start();
  openAdvanced(original.id);
  useCapture.getState().updateComponent(original.id, { fields: { ...find(original.id).fields, title: "Changed from Fields" } });
  const updated = find(original.id);
  assert.equal(updated.code.custom, false);
  assert.equal(updated.code.pvoLiteral, true);
  assert.match(updated.code.pvo.structure, /<title>Changed from Fields<\/title>/);
  assert.equal(updated.code.pvoCompiled.structure.title, "Changed from Fields");
  assert.equal(fieldsShownFor(updated).title, "Changed from Fields");
});

test("accepting Advanced compilation synchronizes labels and outcomes without adding history", () => {
  const original = start();
  const opened = openAdvanced(original.id);
  useCapture.getState().updateComponent(original.id, { code: {
    ...opened.code, pvoTouched: true,
    pvo: { structure: '<card><title>Authored</title><body>Details</body><button id="learn">Explore</button></card>',
      style: "#learn { color: #abc; }", logic: "on press(learn) { jump_to(4); }" },
  } });
  const pending = find(original.id);
  const historyLength = useCapture.getState().past.length;
  acceptComponentCompilation(pending, compiledCard());
  const accepted = find(original.id);
  assert.equal(accepted.fields.title, "Authored");
  assert.deepEqual(accepted.fields.buttons, [{ label: "Explore", outcome: { kind: "time", t: 4 } }]);
  assert.equal(accepted.code.custom, true);
  assert.equal(accepted.code.pvoTouched, false);
  assert.equal(accepted.code.pvoLiteral, true);
  assert.equal(useCapture.getState().past.length, historyLength);
  assert.equal(fieldsShownFor(accepted), accepted.fields);
});

test("custom label edits keep source, Fields and compiled metadata together through undo and redo", () => {
  const original = authorCard();
  const before = plain(original);
  const historyLength = useCapture.getState().past.length;
  useCapture.getState().updateComponent(original.id, { fields: { ...original.fields, title: "From no-code" } });
  const updated = find(original.id);
  assert.equal(updated.code.pvoCompiled.structure.title, "From no-code");
  assert.match(updated.code.pvo.structure, /<title>From no-code<\/title>/);
  assert.equal(updated.code.pvo.style, original.code.pvo.style);
  assert.equal(updated.code.pvo.logic, original.code.pvo.logic);
  assert.equal(updated.code.pvoCompiled.structure.buttons[0].id, "learn");
  assert.equal(useCapture.getState().past.length, historyLength + 1);
  const after = plain(updated);
  useCapture.getState().undo();
  assert.deepEqual(plain(find(original.id)), before);
  useCapture.getState().redo();
  assert.deepEqual(plain(find(original.id)), after);
});

test("shared outcome commands synchronize custom request Logic while preserving content and styling", () => {
  const original = authorCard();
  const request = {
    kind: "request", url: "https://api.example.com/submit", method: "POST", body: '{"name":"{state.form.name}"}',
    onSuccess: { kind: "time", t: 6 }, onError: continuing,
  };
  useCapture.getState().updateOutcome(original.id, { kind: "button", index: 0 }, request);
  const updated = find(original.id);
  assert.deepEqual(updated.fields.buttons[0].outcome, request);
  assert.deepEqual(updated.code.pvoCompiled.rules[0].action, request);
  assert.equal(updated.code.pvo.structure, original.code.pvo.structure);
  assert.equal(updated.code.pvo.style, original.code.pvo.style);
  assert.match(updated.code.pvo.logic, /on press\(learn\)/);
  assert.match(updated.code.pvo.logic, /request\(/);
  assert.deepEqual(componentLanguageSource(updated), updated.code.pvo);
});

test("pending Advanced drafts resist Fields and outcome commands without adding undo entries", () => {
  const original = authorCard();
  useCapture.getState().updateComponent(original.id, { code: {
    ...original.code, pvoTouched: true, pvo: { ...original.code.pvo, logic: "on press(learn) {" },
  } });
  const before = saved();
  useCapture.getState().updateOutcome(original.id, { kind: "button", index: 0 }, continuing);
  useCapture.getState().updateComponent(original.id, { fields: { ...find(original.id).fields, title: "Would overwrite" } });
  assert.deepEqual(saved(), before);
});

test("timing and placement remain editable independently of pending Advanced source", () => {
  const original = authorCard();
  useCapture.getState().updateComponent(original.id, { code: {
    ...original.code, pvoTouched: true, pvo: { ...original.code.pvo, logic: "on press(learn) {" },
  } });
  const pending = find(original.id);
  useCapture.getState().updateComponent(original.id, { at: 2, dur: 5, x: 60, y: 40 });
  const updated = find(original.id);
  assert.deepEqual([updated.at, updated.dur, updated.x, updated.y], [2, 5, 60, 40]);
  assert.equal(updated.fields, pending.fields);
  assert.equal(updated.code, pending.code);
});

test("stale compiler results cannot overwrite newer source, Fields edits, resets, deletion, or history", () => {
  for (const change of [
    old => useCapture.getState().updateComponent(old.id, { code: {
      ...old.code, pvoTouched: true, pvo: { ...old.code.pvo, structure: "<card>Newer draft" },
    } }),
    old => useCapture.getState().updateComponent(old.id, { fields: { ...old.fields, title: "Newer fields" } }),
    old => useCapture.getState().updateComponent(old.id, { fields: old.fields, code: undefined }),
    old => useCapture.getState().deleteComponent(old.id),
    () => useCapture.getState().undo(),
  ]) {
    const old = authorCard();
    change(old);
    const before = saved();
    acceptComponentCompilation(old, compiledCard("Stale compiler result"));
    assert.deepEqual(saved(), before);
  }
});

test("a compiler result remains applicable across unrelated timing edits", () => {
  const original = authorCard();
  useCapture.getState().updateComponent(original.id, { code: {
    ...original.code, pvoTouched: true,
    pvo: { ...original.code.pvo, structure: original.code.pvo.structure.replace("Authored", "New title") },
  } });
  const pending = find(original.id);
  useCapture.getState().updateComponent(original.id, { at: 3 });
  const historyLength = useCapture.getState().past.length;
  acceptComponentCompilation(pending, compiledCard("New title"));
  assert.equal(find(original.id).at, 3);
  assert.equal(find(original.id).fields.title, "New title");
  assert.equal(find(original.id).code.pvoTouched, false);
  assert.equal(useCapture.getState().past.length, historyLength);
});

test("Fields typing preserves trailing spaces after compiler normalization", () => {
  const original = authorCard();
  useCapture.getState().updateComponent(original.id, { fields: { ...original.fields, title: "New " } });
  const updated = find(original.id);
  acceptComponentCompilation(updated, compiledCard("New"));
  const accepted = find(original.id);
  assert.equal(accepted.fields.title, "New ");
  assert.equal(fieldsShownFor(accepted).title, "New ");
  assert.match(accepted.code.pvo.structure, /<title>New <\/title>/);
  assert.equal(accepted.code.pvoCompiled.structure.title, "New");
});

test("legacy tokens materialize once and token-shaped field text survives subsequent compilation", () => {
  const original = start("tooltip");
  useCapture.getState().updateComponent(original.id, { fields: { text: "{{text}}" }, code: {
    custom: false, pvoTouched: true,
    pvo: { structure: "<tooltip><text>Hello {{text}}</text></tooltip>", style: "", logic: "" },
  } });
  const pending = find(original.id);
  const compiled = { structure: { type: "tooltip", text: "Hello {{text}}" }, rules: [], html: "", css: "", js: "" };
  assert.equal(resolveLanguageSource(pending, pending.code.pvo).structure, "<tooltip><text>Hello {{text}}</text></tooltip>");
  acceptComponentCompilation(pending, compiled);
  const accepted = find(original.id);
  assert.equal(accepted.fields.text, "Hello {{text}}");
  assert.equal(accepted.code.pvoLiteral, true);
  assert.equal(resolveLanguageSource(accepted, accepted.code.pvo).structure, "<tooltip><text>Hello {{text}}</text></tooltip>");
  const before = saved();
  acceptComponentCompilation(accepted, compiled);
  assert.deepEqual(saved(), before);
  const copyId = useCapture.getState().duplicateComponent(original.id);
  assert.equal(find(copyId).code.pvoLiteral, true);
  assert.equal(componentLanguageSource(find(copyId)).structure, accepted.code.pvo.structure);
});

test("export selects an invalid first Advanced draft instead of silently regenerating Fields", () => {
  const original = start();
  const opened = openAdvanced(original.id);
  const invalid = { ...opened.code.pvo, structure: "<card><title>Incomplete" };
  useCapture.getState().updateComponent(original.id, { code: { ...opened.code, pvoTouched: true, pvo: invalid } });
  const pending = find(original.id);
  assert.equal(pending.code.custom, false);
  assert.deepEqual(componentLanguageSource(pending), invalid);
  const unedited = { ...pending, code: { ...pending.code, pvoTouched: false } };
  assert.notEqual(componentLanguageSource(unedited).structure, invalid.structure);
  assert.match(componentLanguageSource(unedited).structure, /<title>New message<\/title>/);
});
