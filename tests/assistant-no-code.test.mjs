import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../packages/pvo-language/index.js";
import { validateAssistantProposal } from "../server/assistant/policy.js";
import { assistantMessages } from "../server/assistant/prompt.js";
import { parseAssistantRequest, parseAssistantResponse } from "../packages/pvo-assistant/index.js";

initSync({ module: new WebAssembly.Module(await readFile(new URL("../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url))) });
const source = { structure: '<card><title>Ready</title><body>Hello</body><button id="next">Continue</button></card>',
  style: 'card { background: #123456; } title { font-size: 17px; }', logic: 'on press(next) { continue(); }' };
const context = { currentSceneId: "main", duration: 8, scenes: [{ id: "main", name: "Main" }] };
const input = { componentType: "card", source, prompt: "Change it", context, editingMode: "no-code" };
const draft = next => ({ source: next, summary: "Changed", tags: [], followUps: ["Blue", "Smaller", "Softer"] });
const advanced = error => error.code === "advanced_required";
const action = { url: "https://example.com", method: "POST", body: "{}", onSuccess: { kind: "continue" }, onError: null };
async function propose(next, request = input) {
  const original = await compilePvoComponent(request.componentType, request.source);
  return validateAssistantProposal(request, original, draft(next), compilePvoComponent);
}

test("Advanced off still accepts custom PVO appearances and wording", async () => {
  const next = { ...source, structure: source.structure.replace("Ready", "A longer title outside the visual input limit"),
    style: 'card { background: rgba(0,0,0,0.5); border-radius: 11px; } title { font-size: 23px; font-weight: 900; } body { background: #fff; }' };
  const result = await propose(next);
  assert.match(result.css, /23px/);
  assert.match(result.structure.title, /outside/);
  const { editingMode, ...legacy } = input;
  await propose(next, legacy);
  assert.match(assistantMessages(input)[0].content, /ONLY to LOGIC, never appearance or wording/);
});

test("Advanced off permits all no-code playback actions", async () => {
  for (const action of ['continue()', 'jump_to(3)', 'go_to_scene("main")'])
    await propose({ ...source, logic: `on press(next) { ${action}; }` });
});

test("Advanced off rejects new or altered request behavior before review", async () => {
  const requested = { ...source, logic: `on press(next) { request(${JSON.stringify(action)}); }` };
  await assert.rejects(propose(requested), advanced);
  for (const next of [
    source,
    { ...requested, logic: requested.logic.replace('"continue"', '"time","t":2') },
    { ...requested, logic: requested.logic.replace('https://example.com', 'https://other.example.com') },
  ]) await assert.rejects(propose(next, { ...input, source: requested }), advanced);
});

test("unchanged advanced logic survives appearance edits with the switch off", async () => {
  const original = { ...source, logic: `on press(next) { request(${JSON.stringify(action)}); }` };
  const result = await propose({ ...original, structure: original.structure.replace("Ready", "Welcome"),
    style: 'title { font-size: 25px; }' }, { ...input, source: original });
  assert.deepEqual(result.rules[0].action, { kind: "request", ...action });
});

test("Advanced preserves the existing assistant request and compiler boundaries", async () => {
  await propose({ ...source, style: 'title { font-size: 23px; font-weight: 900; }' }, { ...input, editingMode: "advanced" });
  await assert.rejects(propose({ ...source, logic: `on press(next) { request(${JSON.stringify(action)}); }` },
    { ...input, editingMode: "advanced" }), error => error.code === "request_changed");
});

test("mode and logic refusal are bounded contract data, never coerced truthy", async () => {
  for (const editingMode of [true, false, "false", "", null]) assert.throws(() => parseAssistantRequest({ ...input, editingMode }));
  assert.equal(parseAssistantRequest(input).editingMode, "no-code");
  for (const requiresAdvancedLogic of ["false", 1, null]) assert.throws(() => parseAssistantResponse({ ...draft(source), requiresAdvancedLogic }));
  const original = await compilePvoComponent("card", source);
  await assert.rejects(validateAssistantProposal(input, original, { ...draft(source), requiresAdvancedLogic: true }, compilePvoComponent), advanced);
});
