import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent, PvoLanguageError } from "../packages/pvo-language/index.js";
import { AssistantPolicyError, validateCompiledAssistantOriginal, validateCompiledAssistantProposal } from "../packages/pvo-assistant/policy.js";

initSync({ module: new WebAssembly.Module(await readFile(new URL("../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url))) });

const context = { currentSceneId: "main", duration: 6, scenes: [{ id: "main", name: "Main" }, { id: "branch", name: "Branch" }] };
const source = { structure: '<card><title>Ready</title><button id="next">Continue</button></card>', style: "", logic: "on press(next) { continue(); }" };
const input = (overrides = {}) => ({ componentType: "card", source, prompt: "Make it blue", context, editingMode: "advanced", ...overrides });

async function compileOriginal(request) {
  const compiled = await compilePvoComponent(request.componentType, request.source);
  validateCompiledAssistantOriginal(compiled, request.context);
  return compiled;
}

async function propose(request, next) {
  const original = await compileOriginal(request);
  const proposed = await compilePvoComponent(request.componentType, next);
  validateCompiledAssistantProposal(original, proposed, request.context);
  return proposed;
}

function policyCode(code) {
  return error => error instanceof AssistantPolicyError && error.code === code;
}

test("exact PVO source compiles with escaped text and bounded project routes", async () => {
  const compiled = await propose(input(), { ...source,
    structure: source.structure.replace("Ready", "JavaScript &amp; Python"),
    style: "card { background: #123456; } #next { font-size: 24px; }",
    logic: 'on press(next) { go_to_scene("branch"); }',
  });
  assert.equal(compiled.js, "");
  assert.equal(compiled.structure.title, "JavaScript & Python", "Language names remain ordinary safe copy");
  assert.deepEqual(compiled.rules[0].action, { kind: "scene", sceneId: "branch" });
  assert.match(compiled.html, /JavaScript &amp; Python/);
  await propose(input(), { ...source, logic: "on press(next) { jump_to(6); }" });
});

test("raw HTML, arbitrary CSS and programming code are rejected rather than sanitized", async () => {
  const invalid = [
    { ...source, structure: '<div onclick="alert(1)">Hello</div>' },
    { ...source, structure: '<card><title><script>alert(1)</script></title></card>' },
    { ...source, structure: '<tooltip><text>Wrong kind</text></tooltip>', logic: "" },
    ...["position: fixed", "background: url(https://example.com/image)", "--custom: #fff", "font-size: 999px"].map(declaration =>
      ({ ...source, style: `card { ${declaration}; }` })),
    { ...source, style: "button:hover { color: #fff; }" },
    { ...source, logic: 'fetch("https://example.com");' },
    { ...source, logic: 'print("Hello")' },
    { ...source, logic: "on press(missing) { continue(); }" },
    { ...source, logic: "" },
  ];
  for (const candidate of invalid) await assert.rejects(propose(input(), candidate), error => error instanceof PvoLanguageError);
});

test("project context rejects absent scenes, out-of-range times and new routes without context", async () => {
  for (const action of ['go_to_scene("missing")', "jump_to(6.1)"])
    await assert.rejects(propose(input(), { ...source, logic: `on press(next) { ${action}; }` }), policyCode("invalid_route"));
  const noContext = input({ context: undefined });
  await assert.rejects(propose(noContext, { ...source, logic: 'on press(next) { go_to_scene("branch"); }' }), policyCode("invalid_route"));
  const existing = { ...source, logic: 'on press(next) { go_to_scene("branch"); }' };
  await propose(input({ source: existing, context: undefined }), { ...existing, style: "title { color: #fff; }" });
});

test("Choice remains exactly two options even though the language accepts more", async () => {
  const choice = {
    structure: '<choice><prompt>Choose</prompt><option id="a">A</option><option id="b">B</option></choice>',
    style: "", logic: "on choose(a) { continue(); } on choose(b) { continue(); }",
  };
  const three = { ...choice, structure: choice.structure.replace("</choice>", '<option id="c">C</option></choice>'),
    logic: `${choice.logic} on choose(c) { continue(); }` };
  assert.equal((await compilePvoComponent("choice", three)).structure.options.length, 3);
  await assert.rejects(propose(input({ componentType: "choice", source: choice }), three), policyCode("invalid_component"));
});

const requestAction = {
  url: "https://forms.example/submit", method: "POST", body: JSON.stringify({ email: "{state.form.selected.email}" }),
  onSuccess: { kind: "scene", sceneId: "branch" }, onError: { kind: "continue" },
};
function formSource(action = requestAction) {
  return { structure: '<form><heading>Join</heading><field name="email" kind="email" label="Email"/><submit waiting="Sending…">Send</submit></form>',
    style: "", logic: `on submit { request(${JSON.stringify(action)}); }` };
}

test("visual edits preserve authored requests without granting or changing network effects", async () => {
  const original = formSource();
  const request = input({ componentType: "form", source: original });
  const safe = await propose(request, { ...original, style: "submit { background: #3355ff; }",
    structure: original.structure.replace('label="Email"', 'label="Your email"') });
  assert.deepEqual(safe.rules[0].action, { kind: "request", ...requestAction });
  const changes = [
    { url: "https://other.example/submit" }, { url: "https://forms.example/other" },
    { method: "GET", body: "" }, { body: '{"extra":true}' },
    { onSuccess: { kind: "continue" } }, { onError: null },
  ];
  for (const change of changes)
    await assert.rejects(propose(request, formSource({ ...requestAction, ...change })), policyCode("request_changed"));
  await assert.rejects(propose(request, { ...original, logic: "on submit { continue(); }" }), policyCode("request_changed"));
  await assert.rejects(propose(input(), { ...source, logic: `on press(next) { request(${JSON.stringify(requestAction)}); }` }), policyCode("request_changed"));
});

test("request-bound field identities and request event targets remain stable", async () => {
  const original = formSource();
  for (const replacement of ['name="address" kind="email"', 'name="email" kind="short"'])
    await assert.rejects(propose(input({ componentType: "form", source: original }), {
      ...original, structure: original.structure.replace('name="email" kind="email"', replacement),
    }), policyCode("request_fields_changed"));

  const card = { ...source, logic: `on press(next) { request(${JSON.stringify(requestAction)}); }` };
  await assert.rejects(propose(input({ source: card }), {
    ...card, structure: card.structure.replace('id="next"', 'id="renamed"'), logic: card.logic.replace("press(next)", "press(renamed)"),
  }), policyCode("request_changed"));
});

test("copy edits cannot switch request-bound yes/no values between strings and booleans", async () => {
  const original = { ...formSource(), structure: '<form><field name="consent" kind="yesno"/><submit>Send</submit></form>' };
  const labeled = { ...original, structure: original.structure.replace('<field ', '<heading>Join</heading><field ') };
  const request = input({ componentType: "form", source: original });
  await assert.rejects(propose(request, labeled), policyCode("request_fields_changed"));
  await assert.rejects(propose({ ...request, source: labeled }, original), policyCode("request_fields_changed"));
  await propose({ ...request, source: labeled }, { ...labeled, structure: labeled.structure.replace("Join", "Subscribe") });
  await propose(request, { ...original, style: "submit { color: #fff; }" });
});

test("invalid original source/context fails before proposal work and diagnostics are preserved", async () => {
  await assert.rejects(compileOriginal(input({ source: { ...source, style: "card { width: 90px; }" } })), error => {
    assert.equal(error.part, "style");
    assert.equal(error.diagnostic.code, "invalid_style");
    assert.ok(error.diagnostic.line > 0 && error.diagnostic.column > 0);
    return error instanceof PvoLanguageError;
  });
  await assert.rejects(compileOriginal(input({ source: formSource(), componentType: "form", context: { ...context, scenes: [context.scenes[0]] } })), policyCode("invalid_route"));
  await assert.rejects(compilePvoComponent("card", { ...source, style: "card { width: 1px; }" }), PvoLanguageError);
});

test("compiled script output cannot cross the assistant boundary", async () => {
  const original = await compilePvoComponent("card", source);
  assert.throws(() => validateCompiledAssistantProposal(original, { ...original, js: "alert(1)" }, context), policyCode("executable_code"));
});
