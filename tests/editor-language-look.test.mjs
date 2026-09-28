import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../packages/pvo-language/index.js";

initSync({ module: new WebAssembly.Module(await readFile(new URL("../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url))) });
const bundled = buildSync({ stdin: { contents: `
  export * from './editor/src/domain/components/languageLook.ts';
  export { fieldsFromCompiled } from './editor/src/domain/components/fields.ts';
  export { createLook, componentLook } from './editor/src/domain/components/look.ts';
  export { componentLookLanguage } from './editor/src/domain/components/lookLanguage.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { projectComponentLook, componentLookCustomValues, editComponentLook, fieldsFromCompiled, createLook, componentLook, componentLookLanguage } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

async function card(style = "") {
  return fixture("card", {
    structure: '<card><title>Keep {{literal}} &amp; text</title><body>Details</body><button id="primary">Next</button><button id="secondary">Stay</button></card>',
    style, logic: 'on press(primary) { jump_to(2); }\non press(secondary) { continue(); }',
  });
}

async function fixture(type, source) {
  const compiled = await compilePvoComponent(type, source);
  return { id: "component-test", sceneId: "main", type, at: 0, dur: 5, x: 50, y: 50,
    fields: fieldsFromCompiled(compiled), look: createLook("bold", type === "card" ? 2 : type === "tooltip" ? 0 : 1),
    code: { custom: true, pvoLiteral: true, pvoTouched: false, pvo: source, pvoLastValid: source,
      pvoCompiled: { structure: compiled.structure, rules: compiled.rules } } };
}

function apply(component, edit, properties, replace = false) {
  const next = projectComponentLook(component);
  edit(next);
  return { ...component, ...editComponentLook(component, next, { properties, replace }) };
}

test("style projection follows source order across generic/local selectors and colour aliases", async () => {
  const component = await card(`#primary { background: #123456; font-size: 23px; }
    button { background-color: rgba(12, 34, 56, .5); font-size: 17px; }
    #secondary { background: #fed; }
    card { background: #fff; background-color: #112233; }
    title { font-size: 23px; }
    body { font-weight: 900; }`);
  const look = componentLook(component);
  assert.equal(look.whole.bg, "#112233");
  assert.equal(look.btns[0].fill, "rgba(12, 34, 56, .5)");
  assert.equal(look.btns[1].fill, "#fed");
  const custom = componentLookCustomValues(component);
  assert.equal(custom["heading.size"], "23px");
  assert.equal(custom["btns.0.size"], "17px");
  assert.equal(custom["body.weight"], "900");
});

test("one visual colour edit preserves exact source tokens, unrelated styles and outcomes", async () => {
  const component = await card("card { background-color: #123456; border-radius: 24px; }\n#primary { font-size: 23px; font-weight: 900; }\nbody { color: rgba(10, 20, 30, .4); }");
  const updated = apply(component, look => { look.whole.bg = "#ABCDEF"; }, ["whole.bg"]);
  assert.equal(updated.code.pvo.structure, component.code.pvo.structure);
  assert.equal(updated.code.pvo.logic, component.code.pvo.logic);
  assert.ok(updated.code.pvo.style.includes("#primary { font-size: 23px; font-weight: 900; }"));
  assert.ok(updated.code.pvo.style.includes("body { color: rgba(10, 20, 30, .4); }"));
  assert.ok(updated.code.pvo.style.includes("border-radius: 24px;"));
  assert.equal(projectComponentLook(updated).whole.bg, "#ABCDEF");
  assert.deepEqual(updated.code.pvoLastValid, updated.code.pvo);
  await compilePvoComponent(updated.type, updated.code.pvo);
});

test("explicit size selection replaces an off-preset value even when its nearest enum matches", async () => {
  const component = await card("title { font-size: 23px; } #primary { color: #1234; }");
  assert.equal(projectComponentLook(component).heading.size, "XL");
  const updated = apply(component, look => { look.heading.size = "XL"; }, ["heading.size"]);
  assert.equal(componentLookCustomValues(updated)["heading.size"], undefined);
  assert.match(updated.code.pvo.style, /font-size: 20px;/);
  assert.ok(updated.code.pvo.style.includes("#primary { color: #1234; }"));
  await compilePvoComponent(updated.type, updated.code.pvo);
});

test("local control edits use authored identities and override later generic rules only for that control", async () => {
  const component = await card("#primary { background: #111; color: #fff; }\nbutton { background: #222; }\n#secondary { border-color: #333; }");
  const updated = apply(component, look => { look.btns[0].fill = "#FF0000"; }, ["btns.0.fill"]);
  const look = projectComponentLook(updated);
  assert.equal(look.btns[0].fill, "#FF0000");
  assert.equal(look.btns[1].fill, "#222");
  assert.ok(updated.code.pvo.style.includes("button { background: #222; }"));
  assert.ok(!updated.code.pvo.style.includes("#button0"));
  assert.equal(updated.code.pvo.logic, component.code.pvo.logic);
  await compilePvoComponent(updated.type, updated.code.pvo);
});

test("preset replacement targets real IDs and changes only Style", async () => {
  const component = await card("#primary { color: #1234; } #secondary { font-size: 45px; }");
  const preset = createLook("soft", 2);
  const updated = { ...component, ...editComponentLook(component, preset, { replace: true }) };
  assert.equal(updated.code.pvo.structure, component.code.pvo.structure);
  assert.equal(updated.code.pvo.logic, component.code.pvo.logic);
  assert.ok(updated.code.pvo.style.includes("#primary"));
  assert.ok(updated.code.pvo.style.includes("#secondary"));
  assert.ok(!updated.code.pvo.style.includes("#button0"));
  assert.deepEqual(projectComponentLook(updated), preset);
  assert.equal(componentLookLanguage(updated), updated.code.pvo.style);
  await compilePvoComponent(updated.type, updated.code.pvo);
});

test("repeated visual edits remain bounded instead of accumulating override rules", async () => {
  let component = await card("card { border-radius: 24px; } #primary { color: #fff; }");
  for (let count = 0; count < 100; count++) {
    component = apply(component, look => { look.whole.bg = count % 2 ? "#123456" : "#654321"; }, ["whole.bg"]);
  }
  assert.ok(component.code.pvo.style.length < 180);
  assert.equal((component.code.pvo.style.match(/background:/g) ?? []).length, 1);
  await compilePvoComponent(component.type, component.code.pvo);
});

test("invalid/pending drafts show the last valid appearance and resist visual overwrites", async () => {
  const component = await card("card { background: #123456; }");
  const pending = { ...component, code: { ...component.code, pvoTouched: true,
    pvo: { ...component.code.pvo, style: "card { background: url(https://example.com/private);" } } };
  assert.equal(projectComponentLook(pending).whole.bg, "#123456");
  const next = projectComponentLook(pending);
  next.whole.bg = "#fff";
  assert.deepEqual(editComponentLook(pending, next, { properties: ["whole.bg"] }), { look: pending.look, code: pending.code });
  const untrusted = { ...pending, code: { ...pending.code, pvoLastValid: undefined, pvoTouched: false } };
  assert.equal(projectComponentLook(untrusted).whole.bg, "#15151C", "Malformed saved source cannot paint host UI");
});

test("style-only validation cannot promote an uncompiled visual content draft to last valid source", async () => {
  const component = await card("card { background: #123456; }");
  const typing = { ...component, code: { ...component.code,
    pvo: { ...component.code.pvo, structure: component.code.pvo.structure.replace("Keep {{literal}} &amp; text", "") } } };
  const updated = apply(typing, look => { look.whole.bg = "#ABCDEF"; }, ["whole.bg"]);
  assert.equal(updated.code.pvo.structure, typing.code.pvo.structure);
  assert.deepEqual(updated.code.pvoLastValid, component.code.pvoLastValid);
  await assert.rejects(compilePvoComponent(updated.type, updated.code.pvo), /needs text/);
  await compilePvoComponent(updated.type, updated.code.pvoLastValid);
});

test("the style mapper accepts Rust whitespace while preserving declaration grammar", async () => {
  const component = await card("card\u0085{\u0085background\u0085:\u0085#123456\u0085;\u0085}\u0085title { font-size: 23px; }");
  assert.equal(projectComponentLook(component).whole.bg, "#123456");
  assert.equal(componentLookCustomValues(component)["heading.size"], "23px");
  const updated = apply(component, look => { look.whole.bg = "#ABCDEF"; }, ["whole.bg"]);
  await compilePvoComponent(updated.type, updated.code.pvo);
});

test("currentColor tokens and mixed form field values survive unrelated edits", async () => {
  const component = await fixture("form", {
    structure: '<form><heading>Join</heading><field name="email_address" kind="email" label="Email"/><field name="full_name" kind="name" label="Name"/><submit>Send</submit></form>',
    style: "form { color: #123456; } heading { color: currentColor; } field { font-size: 16px; } #full_name { font-size: 21px; }",
    logic: "on submit { continue(); }",
  });
  const look = projectComponentLook(component);
  const custom = componentLookCustomValues(component);
  assert.equal(look.heading.color, "#123456");
  assert.equal(custom["heading.color"], "currentColor");
  assert.equal(custom["body.size"], "Mixed");
  const updated = apply(component, next => { next.whole.bg = "#ABCDEF"; }, ["whole.bg"]);
  assert.ok(updated.code.pvo.style.includes("heading { color: currentColor; }"));
  assert.ok(updated.code.pvo.style.includes("#full_name { font-size: 21px; }"));
  const uniform = apply(updated, next => { next.body.size = "L"; }, ["body.size"]);
  assert.equal(componentLookCustomValues(uniform)["body.size"], undefined);
  await compilePvoComponent(uniform.type, uniform.code.pvo);
});
