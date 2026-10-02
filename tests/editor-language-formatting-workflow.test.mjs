import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { projectSnapshot } from "./editor/src/state/project/history.ts";
      export { acceptComponentCompilation, acceptFormattedComponentSource } from "./editor/src/state/components/componentLanguageCommands.ts";
      export { beginPvoEdit } from "./editor/src/domain/components/codeOwnership.ts";
      export { preparePvoFormatting } from "./editor/src/domain/components/languageFormatPreparation.ts";
      export { formatPvoSource } from "./editor/src/domain/components/languageFormatting.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, projectSnapshot, acceptComponentCompilation, acceptFormattedComponentSource,
  beginPvoEdit, preparePvoFormatting, formatPvoSource } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const compact = {
  structure: '<card><title>Plan</title><body>Keep this wording</body><button id="next">Explore</button></card>',
  style: 'card{color:#123456;}#next{font-size:21px;}',
  logic: 'on press(next){jump_to(4);}',
};
const compiled = {
  structure: { type: "card", title: "Plan", body: "Keep this wording", buttons: [{ id: "next", label: "Explore" }] },
  rules: [{ event: "press", target: "next", action: { kind: "time", t: 4 } }],
  html: '<button data-id="next">Explore</button>', css: '.component { color: #123456; }', js: "compiled action",
};
const formatted = formatPvoSource(compact);
const plain = value => JSON.parse(JSON.stringify(value));
const find = id => useCapture.getState().components.find(component => component.id === id);
const saved = () => structuredClone({
  project: projectSnapshot(useCapture.getState()), past: useCapture.getState().past,
  future: useCapture.getState().future, selComp: useCapture.getState().selComp,
});

function authorCard() {
  const state = initial();
  state.scenes[0].clips = [mkClip(8, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  const id = useCapture.getState().addComponent("card");
  useCapture.getState().updateComponent(id, {
    fields: { title: "Plan", body: "Keep this wording", buttons: [{ label: "Explore", outcome: { kind: "time", t: 4 } }] },
    code: { custom: true, pvoLiteral: true, pvoTouched: false, pvo: { ...compact }, pvoLastValid: { ...compact },
      pvoCompiled: { structure: structuredClone(compiled.structure), rules: structuredClone(compiled.rules) } },
  }, false);
  return find(id);
}

test("format preparation accepts independently compiled but deeply identical output", async () => {
  const calls = [];
  const before = structuredClone(compact);
  const result = await preparePvoFormatting("card", compact, async (type, source) => {
    calls.push({ type, source });
    return structuredClone(compiled);
  });
  assert.deepEqual(calls, [{ type: "card", source: compact }, { type: "card", source: formatted }]);
  assert.deepEqual(result, { source: formatted, compiled });
  assert.notDeepEqual(result.source, compact);
  assert.deepEqual(compact, before, "Preparing a format must not mutate the current draft");
});

test("format preparation reuses validated original output and skips compilation for unchanged source", async () => {
  const calls = [];
  const compile = async (type, source) => { calls.push({ type, source }); return structuredClone(compiled); };
  assert.deepEqual(await preparePvoFormatting("card", compact, compile, compiled), { source: formatted, compiled });
  assert.deepEqual(calls, [{ type: "card", source: formatted }]);
  const noOp = await preparePvoFormatting("card", formatted, async () => {
    assert.fail("Already formatted source must not compile or create work");
  });
  assert.equal(noOp, null);
});

test("format preparation declines compiler drift in content, actions or rendered output", async () => {
  for (const change of [
    result => { result.structure.body = "Changed wording"; },
    result => { result.rules[0].action.t = 7; },
    result => { result.html += "changed"; },
    result => { result.css += "changed"; },
    result => { result.js += "changed"; },
  ]) {
    let count = 0;
    const result = await preparePvoFormatting("card", compact, async () => {
      const output = structuredClone(compiled);
      if (count++ === 1) change(output);
      return output;
    });
    assert.equal(count, 2);
    assert.equal(result, null, "A format cannot alter compiled behavior or appearance");
  }
});

test("format preparation preserves valid source when formatted compilation fails, and exposes invalid original errors", async () => {
  let count = 0;
  const result = await preparePvoFormatting("card", compact, async () => {
    if (count++ === 0) return compiled;
    throw new Error("Formatted output is unsupported");
  });
  assert.equal(result, null);
  assert.equal(count, 2);
  const invalid = new Error("Original Logic has a missing target");
  const invalidSource = { ...compact, logic: "on press(missing){jump_to(4);}" };
  await assert.rejects(preparePvoFormatting("card", invalidSource, async () => { throw invalid; }), error => error === invalid);
});

test("format commit preserves Fields and Look references and gives one complete undo and redo", () => {
  const before = authorCard();
  const original = plain(before);
  const historyLength = useCapture.getState().past.length;
  assert.equal(acceptFormattedComponentSource(before, formatted, compiled), true);
  const after = find(before.id);
  assert.equal(after.fields, before.fields);
  assert.equal(after.look, before.look);
  assert.equal(after.fields.buttons[0].outcome, before.fields.buttons[0].outcome);
  assert.deepEqual(after.code.pvo, formatted);
  assert.deepEqual(after.code.pvoLastValid, formatted);
  assert.notEqual(after.code.pvo, formatted, "The stored source is independent of the prepared result object");
  assert.equal(after.code.pvoTouched, false);
  assert.deepEqual(after.code.pvoCompiled, { structure: compiled.structure, rules: compiled.rules });
  assert.equal(useCapture.getState().past.length, historyLength + 1);
  const accepted = plain(after);
  useCapture.getState().undo();
  assert.deepEqual(plain(find(before.id)), original, "Undo restores the exact compact source and its component");
  assert.equal(useCapture.getState().past.length, historyLength);
  useCapture.getState().redo();
  assert.deepEqual(plain(find(before.id)), accepted, "Redo restores the formatted source with the same behavior");
});

test("automatic blur formatting joins the typing history entry and redo restores the formatted edit", () => {
  const beforeTyping = authorCard();
  const original = plain(beforeTyping);
  const historyLength = useCapture.getState().past.length;
  const editedCompiled = structuredClone(compiled);
  editedCompiled.rules[0].action.t = 7;
  useCapture.getState().updateComponent(beforeTyping.id, beginPvoEdit(beforeTyping, "logic", "on press(next){jump_to(7);}"));
  assert.equal(useCapture.getState().past.length, historyLength + 1, "Typing records the edit once");
  acceptComponentCompilation(find(beforeTyping.id), editedCompiled);
  const acceptedTyping = find(beforeTyping.id);
  const formattedEdit = formatPvoSource(acceptedTyping.code.pvo);
  assert.equal(acceptFormattedComponentSource(acceptedTyping, formattedEdit, editedCompiled, false), true);
  const after = find(beforeTyping.id);
  assert.equal(useCapture.getState().past.length, historyLength + 1, "Automatic layout must not add an undo step");
  assert.equal(after.fields, acceptedTyping.fields);
  assert.equal(after.look, acceptedTyping.look);
  assert.deepEqual(after.fields.buttons[0].outcome, { kind: "time", t: 7 });
  assert.deepEqual(after.code.pvo, formattedEdit);
  const formattedVersion = plain(after);
  useCapture.getState().undo();
  assert.deepEqual(plain(find(beforeTyping.id)), original, "One undo restores the component from before typing");
  useCapture.getState().redo();
  assert.deepEqual(plain(find(beforeTyping.id)), formattedVersion, "One redo restores the edit with automatic formatting");
});

test("stale formatting cannot overwrite changed source, equal-value Fields or Look, selection, deletion or history", () => {
  for (const [reason, change] of [
    ["code identity", old => useCapture.getState().updateComponent(old.id, { code: { ...old.code } }, false)],
    ["newer source", old => useCapture.getState().updateComponent(old.id, { code: {
      ...old.code, pvoTouched: true, pvo: { ...old.code.pvo, logic: "on press(next){jump_to(7);}" },
    } })],
    ["Fields identity", old => useCapture.getState().updateComponent(old.id, { fields: { ...old.fields }, code: old.code }, false)],
    ["Look identity", old => useCapture.getState().updateComponent(old.id, { look: { ...old.look }, code: old.code }, false)],
    ["no selection", () => useCapture.getState().patch({ selComp: null })],
    ["another selection", () => useCapture.getState().addComponent("tooltip")],
    ["deleted component", old => useCapture.getState().deleteComponent(old.id)],
    ["undo restored the original data with new references", old => {
      useCapture.getState().updateComponent(old.id, { at: 2 });
      useCapture.getState().undo();
    }],
  ]) {
    const input = authorCard();
    change(input);
    const before = saved();
    assert.equal(acceptFormattedComponentSource(input, formatted, compiled), false, reason);
    assert.deepEqual(saved(), before, `${reason} must preserve project, selection and history`);
  }
});

test("formatting can complete alongside an unrelated placement edit without restoring old geometry", () => {
  const input = authorCard();
  useCapture.getState().updateComponent(input.id, { at: 2, x: 62 });
  const historyLength = useCapture.getState().past.length;
  assert.equal(acceptFormattedComponentSource(input, formatted, compiled), true);
  const result = find(input.id);
  assert.equal(result.at, 2);
  assert.equal(result.x, 62);
  assert.equal(result.fields, input.fields);
  assert.equal(result.look, input.look);
  assert.deepEqual(result.code.pvo, formatted);
  assert.equal(useCapture.getState().past.length, historyLength + 1);
});
