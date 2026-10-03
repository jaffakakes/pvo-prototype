import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../packages/pvo-language/index.js";
import { parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";
import { nativeMessages, nativeCompletionMessages } from "../server/assistant/native/prompt.js";
import { validateCompiledAssistantProposal } from "../packages/pvo-assistant/policy.js";

initSync({ module: new WebAssembly.Module(await readFile(new URL("../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url))) });
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
  export { nativeProjectContext } from './editor/src/domain/assistant/native/context.ts';
  export { nativeExecutionContext } from './editor/src/domain/assistant/native/receipts.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const source = {
  structure: '<form><heading>Keep in touch</heading><field name="contact" kind="phone" label="Phone number"/><submit>Continue</submit></form>',
  style: 'form { background: #102c3b; color: #ffffff; border-color: #102c3b; border-radius: 24px; } heading { font-size: 22px; } field { font-size: 18px; } submit { background: #d2ff70; color: #102c3b; border-radius: 16px; }',
  logic: 'on submit { continue(); }',
};
const project = () => ({ currentSceneId: "main", ratio: "9:16", allowedDomains: [], scenes: [{
  id: "main", name: "Main", parent: null, muted: false, sound: 0, texts: [], components: [], audioClips: [],
  clips: [{ id: 10, url: "blob:private-video", srcDur: 6, in: 0, out: 6, speed: 1, zoom: 1,
    mirror: false, fit: "contain", color: "#000000", width: 720, height: 1280 }],
}] });
const preparation = { createId: () => 100, advancedEditingEnabled: false, compile: compilePvoComponent };
const add = (input = source) => ({ kind: "component.add", sceneId: "main", componentType: "form", at: 0, duration: 6, source: input });
const request = (candidate, execution) => ({ mode: "edit", prompt: "Add a readable custom contact form at the lower right with a different font.",
  history: [], observations: [], project: api.nativeProjectContext(candidate, 0), ...(execution ? { execution } : {}) });
const summary = messages => {
  const line = messages.at(-1).content.split("\n").find(value => value.startsWith("Current component values"));
  return JSON.parse(line.slice(line.indexOf(": ") + 2));
};

test("specific local form source creates a telephone input without Advanced and retains field identity in context and receipts", async () => {
  const before = project();
  const batch = await api.prepareNativeBatch(before, [add()], preparation);
  assert.equal(before.scenes[0].components.length, 0, "Preparing source does not expose a partial live edit");
  const component = batch.project.scenes[0].components[0];
  assert.equal(component.code.pvoTouched, false);
  assert.deepEqual(component.code.pvoCompiled.structure.fields, [{ name: "contact", kind: "phone", label: "Phone number" }]);
  assert.match((await compilePvoComponent("form", component.code.pvo)).html, /type="tel"/);
  assert.deepEqual(component.code.pvoCompiled.rules[0].action, { kind: "continue" });
  const execution = api.nativeExecutionContext(before, batch.receipts);
  const wire = parseNativeTurnRequest(request(batch.project, execution));
  const current = wire.project.scenes[0].components[0];
  assert.match(current.source.structure, /kind="phone"/);
  assert.deepEqual(current.formFields, [{ name: "contact", kind: "phone" }]);
  const created = execution.receipts[0].changes.find(change => change.after?.kind === "component").after.values;
  assert.deepEqual(created.formFields, current.formFields);
  assert.doesNotMatch(JSON.stringify(wire), /blob:private-video|data:font|"value":|"label":"Phone number"/);
  const pending = structuredClone(batch.project);
  pending.scenes[0].components[0].code.pvoTouched = true;
  const pendingContext = parseNativeTurnRequest(request(pending)).project.scenes[0].components[0];
  assert.equal(pendingContext.source, undefined, "An unfinished draft remains undisclosed");
  assert.deepEqual(pendingContext.formFields, current.formFields, "Field summaries use the last compiled structure, not the pending source");
});

test("completion summaries retain actual bounds and font identity after source creation and dependent edits", async () => {
  const before = project();
  const first = await api.prepareNativeBatch(before, [add()], preparation);
  const id = first.project.scenes[0].components[0].id;
  const bytes = await readFile(new URL("../editor/src/fonts/peace-sans.woff2", import.meta.url));
  const font = { id: "web-custom-font", family: "Custom Font", sourceUrl: "https://fonts.example/download",
    licenseUrl: "https://fonts.example/license", licenseText: "Fixture license", faces: [
      { dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, weight: "400", style: "normal" },
    ] };
  const canvas = api.nativeProjectContext(first.project, 0).canvas;
  const width = 300, height = 260, margin = 40;
  const x = 100 * (canvas.width - margin - width / 2) / canvas.width;
  const y = 100 * (canvas.height - margin - height / 2) / canvas.height;
  const second = await api.prepareNativeBatch(first.project, [
    { kind: "component.update", sceneId: "main", componentId: id, changes: { x, y, width, height, scale: 1 } },
    { kind: "font.apply", sceneId: "main", target: { kind: "component", id }, fontId: font.id },
  ], { ...preparation, fonts: new Map([[font.id, font]]) });
  const execution = api.nativeExecutionContext(before, [...first.receipts, ...second.receipts]);
  const input = parseNativeTurnRequest(request(second.project, execution));
  const messages = nativeCompletionMessages(nativeMessages(input, []), { message: "Ready", operations: [], observations: [] }, input);
  const [current] = summary(messages);
  assert.deepEqual([current.x, current.y, current.width, current.height], [x, y, width, height]);
  assert.deepEqual(current.font, { id: font.id, family: font.family });
  assert.deepEqual(current.formFields, [{ name: "contact", kind: "phone" }]);
  assert.ok(Math.abs(canvas.width - (current.x / 100 * canvas.width + current.width / 2) - margin) < 1e-6);
  assert.ok(Math.abs(canvas.height - (current.y / 100 * canvas.height + current.height / 2) - margin) < 1e-6);
  assert.doesNotMatch(JSON.stringify(input), /data:font|Fixture license|fonts\.example/);
  assert.match(messages.at(-1).content, /A form heading does not establish its input kind/);
  assert.match(messages.at(-1).content, /downloaded font does not establish an applied font/);
});

test("form field context accepts compiler kinds and rejects values, arbitrary kinds and unbounded metadata", async () => {
  const kinds = ["name", "email", "phone", "short", "number", "yesno"];
  const allFields = { ...source, structure: `<form><heading>Details</heading>${kinds.map(kind => `<field name="${kind}_field" kind="${kind}" label="${kind}"/>`).join("")}<submit>Continue</submit></form>` };
  const batch = await api.prepareNativeBatch(project(), [add(allFields)], preparation);
  const valid = request(batch.project);
  assert.deepEqual(parseNativeTurnRequest(valid).project.scenes[0].components[0].formFields.map(field => field.kind), kinds);
  for (const fields of [
    [{ name: "phone", kind: "tel" }],
    [{ name: "phone", kind: "phone", value: "+44001234" }],
    [{ name: "phone", kind: "phone", url: "https://private.example/collect" }],
    [{ name: "invalid name", kind: "phone" }],
    Array.from({ length: 21 }, (_, index) => ({ name: `field${index}`, kind: "short" })),
  ]) {
    const invalid = structuredClone(valid);
    invalid.project.scenes[0].components[0].formFields = fields;
    assert.throws(() => parseNativeTurnRequest(invalid), /formFields/);
  }
});

test("form instructions distinguish flexible local fields from preserved request-backed identities", async () => {
  const original = await compilePvoComponent("form", { ...source, structure: source.structure.replace('kind="phone"', 'kind="email"') });
  const phone = await compilePvoComponent("form", source);
  const context = { currentSceneId: "main", duration: 6, scenes: [{ id: "main", name: "Main" }] };
  assert.doesNotThrow(() => validateCompiledAssistantProposal(original, phone, context));
  const network = { url: "https://forms.example/submit", method: "POST", body: "{}", onSuccess: { kind: "continue" }, onError: null };
  const requestedSource = { ...source, logic: `on submit { request(${JSON.stringify(network)}); }` };
  const originalRequest = await compilePvoComponent("form", requestedSource);
  const alteredRequest = await compilePvoComponent("form", { ...requestedSource, structure: source.structure.replace('kind="phone"', 'kind="short"') });
  assert.throws(() => validateCompiledAssistantProposal(originalRequest, alteredRequest, context), error => error.code === "request_fields_changed");
  const instructions = nativeMessages(request(project()), [])[0].content;
  assert.match(instructions, /author its complete source \{structure,style,logic\} directly in component\.add/);
  assert.match(instructions, /supported kinds are name, email, phone, short, number and yesno/);
  assert.match(instructions, /EXISTING request-backed form/);
  assert.match(instructions, /never invent a collection endpoint/);
  assert.match(instructions, /x\/y position its CENTER, not its edge/);
  assert.doesNotMatch(instructions, /Existing request actions, field names\/kinds and their submission semantics MUST/);
});
