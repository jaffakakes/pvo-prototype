import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: { contents: `export * from "./editor/src/store.ts"; export { initial } from "./editor/src/state/project/initial.ts";`, resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, initial, mkClip } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("component duplication remaps its requests and saved source to the new submission identity", () => {
  useCapture.setState(initial());
  const state = useCapture.getState();
  state.patch({ clips: [mkClip(8, null, 0)], screen: "editor" });
  const id = state.addComponent("form");
  const request = {
    kind: "request", method: "POST", url: `https://example.com/answers/{state.form.${id}.field_1}`,
    body: JSON.stringify({ value: `{state.form.${id}.field_1}`, previous: `{state.responses.${id}.id}`, other: "{state.form.other.name}", literal: id }),
    onSuccess: { kind: "continue" }, onError: null,
  };
  const { kind: _kind, ...requestPayload } = request;
  const code = {
    custom: true, pvoLiteral: true, pvoTouched: false,
    pvo: {
      structure: `<form><field name="field_1" kind="short" /><submit>Send</submit></form>`,
      style: "form { color: #fff; }", logic: `on submit { request(${JSON.stringify(requestPayload)}); }`,
    },
    pvoCompiled: { structure: { type: "form", fields: [{ name: "field_1", kind: "short" }], submit: "Send" },
      rules: [{ event: "submit", target: null, action: request }] },
  };
  code.pvoLastValid = { ...code.pvo };
  state.updateComponent(id, { fields: { fieldKinds: ["short"], submitLabel: "Send", outcome: request }, code, archivedCode: structuredClone(code) });
  const original = structuredClone(useCapture.getState().components[0]);
  const history = useCapture.getState().past.length;
  const duplicateId = state.duplicateComponent(id);
  const duplicate = useCapture.getState().components.find(item => item.id === duplicateId);
  assert.equal(useCapture.getState().past.length, history + 1);
  for (const outcome of [duplicate.fields.outcome, duplicate.code.pvoCompiled.rules[0].action, duplicate.archivedCode.pvoCompiled.rules[0].action]) {
    assert.equal(outcome.url, `https://example.com/answers/{state.form.${duplicateId}.field_1}`);
    const body = JSON.parse(outcome.body);
    assert.equal(body.value, `{state.form.${duplicateId}.field_1}`);
    assert.equal(body.previous, `{state.responses.${duplicateId}.id}`);
    assert.equal(body.other, "{state.form.other.name}");
    assert.equal(body.literal, id, "Literal creator text is not an identity reference");
  }
  assert(duplicate.code.pvo.logic.includes(`state.form.${duplicateId}.field_1`));
  assert(duplicate.archivedCode.pvo.logic.includes(`state.form.${duplicateId}.field_1`));
  assert(duplicate.code.pvoLastValid.logic.includes(`state.form.${duplicateId}.field_1`));
  assert(duplicate.archivedCode.pvoLastValid.logic.includes(`state.form.${duplicateId}.field_1`));
  assert.equal(duplicate.code.pvo.structure, original.code.pvo.structure);
  assert.equal(duplicate.code.pvo.style, original.code.pvo.style);
  assert.deepEqual(useCapture.getState().components[0], original);
  state.undo();
  assert.equal(useCapture.getState().components.length, 1);
  state.redo();
  assert.equal(useCapture.getState().components[1].id, duplicateId);
  assert(useCapture.getState().components[1].code.pvo.logic.includes(`state.form.${duplicateId}.field_1`));
});

test("component duplication remaps reactive Note text in current, cached and saved Structure", () => {
  useCapture.setState(initial());
  const state = useCapture.getState();
  state.patch({ clips: [mkClip(8, null, 0)], screen: "editor" });
  const id = state.addComponent("tooltip");
  const text = `Saved: {state.responses.${id}.message}`;
  const source = { structure: `<tooltip><text>${text}</text></tooltip>`, style: "", logic: "" };
  const code = {
    custom: true,
    pvoLiteral: true,
    pvoTouched: false,
    pvo: source,
    pvoLastValid: { ...source },
    pvoCompiled: { structure: { type: "tooltip", text }, rules: [] },
  };
  state.updateComponent(id, { fields: { text }, code, archivedCode: structuredClone(code) });

  const duplicateId = state.duplicateComponent(id);
  const duplicate = useCapture.getState().components.find(item => item.id === duplicateId);
  const expected = `Saved: {state.responses.${duplicateId}.message}`;
  assert.equal(duplicate.fields.text, expected);
  assert.ok(duplicate.code.pvo.structure.includes(expected));
  assert.ok(duplicate.code.pvoLastValid.structure.includes(expected));
  assert.equal(duplicate.code.pvoCompiled.structure.text, expected);
  assert.ok(duplicate.archivedCode.pvo.structure.includes(expected));
  assert.ok(duplicate.archivedCode.pvoLastValid.structure.includes(expected));
  assert.equal(duplicate.archivedCode.pvoCompiled.structure.text, expected);
  assert.equal(useCapture.getState().components[0].fields.text, text);
});
