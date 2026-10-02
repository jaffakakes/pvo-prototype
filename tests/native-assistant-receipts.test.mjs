import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";
import { nativeMessages, nativeCompletionMessages } from "../server/assistant/native/prompt.js";

const bundle = buildSync({ stdin: { contents: `
  export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
  export { nativeProjectContext } from './editor/src/domain/assistant/native/context.ts';
  export { nativeExecutionContext } from './editor/src/domain/assistant/native/receipts.ts';
  export { runNativeTask } from './editor/src/infrastructure/assistant/runNativeTask.ts';
  export { assistantContextHistory } from './editor/src/infrastructure/assistant/contextBudget.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const clip = id => ({ id, url: "blob:private-video", srcDur: 12, in: 0, out: 6,
  speed: 1, zoom: 1, mirror: false, fit: "contain", color: "#000", width: 720, height: 1280 });
function fixture() {
  return { currentSceneId: "main", ratio: "9:16", allowedDomains: ["private.example"], scenes: [{
    id: "main", name: "Main", parent: null, muted: false, sound: 0,
    clips: [clip(11), clip(12)], texts: [{ id: 201, text: "Title", start: 2, end: 4, x: 50, y: 20, color: 2 }],
    components: [], audioClips: [{ id: 301, name: "Narration", url: "blob:private-audio", srcDur: 12,
      in: 0, out: 4, speed: 1, start: 6, muted: false, gain: 1 }],
  }] };
}
let nextId;
const prepare = (before, operations, signal) => api.prepareNativeBatch(before, operations,
  { createId: () => nextId++, advancedEditingEnabled: false, compile: async () => { throw Error("No compilation expected"); }, signal });
const entity = (execution, kind, id) => execution.requestStartValues.find(item => item.entity.kind === kind && item.entity.id === id);
const request = (project, execution) => ({ prompt: "Complete the current edit", mode: "edit", history: [], observations: [],
  project: api.nativeProjectContext(project, 0), ...(execution ? { execution } : {}) });

test("actual receipts associate each extracted ID with its source and expose collateral edits to existing audio", async () => {
  nextId = 10000;
  const original = fixture();
  const batch = await prepare(original, [
    { kind: "audio.extract", sceneId: "main", clipId: 11 },
    { kind: "audio.update", sceneId: "main", audioId: 301, changes: { start: 1, gain: 0.35 } },
    { kind: "audio.extract", sceneId: "main", clipId: 12 },
  ]);
  assert.equal(batch.receipts.length, 3);
  for (const [index, sourceId, generatedId] of [[0, 11, 10000], [2, 12, 10001]]) {
    const receipt = batch.receipts[index];
    assert.deepEqual(receipt.target, { kind: "clip", sceneId: "main", id: sourceId });
    const created = receipt.changes.find(change => change.before === null && change.after.kind === "audio");
    assert.equal(created.after.values.id, generatedId);
    assert.equal(created.after.values.sourceOut, 6);
  }
  const change = batch.receipts[1].changes.find(change => change.after.kind === "audio");
  assert.equal(change.before.values.id, 301);
  assert.equal(change.before.values.name, "Narration");
  assert.equal(change.before.values.start, 6);
  assert.equal(change.after.values.start, 1);
  assert.equal(change.before.values.gain, 1);
  assert.equal(change.after.values.gain, 0.35);
  const execution = api.nativeExecutionContext(original, batch.receipts);
  assert.equal(entity(execution, "audio", 10000).state, null);
  assert.equal(entity(execution, "audio", 301).state.values.start, 6);
  assert.doesNotMatch(JSON.stringify(execution), /blob:|private-video|private-audio|private\.example/);
  assert.doesNotThrow(() => parseNativeTurnRequest(request(batch.project, execution)));
});

test("workflow carries exact request-start values through correction and commits only the repaired final batch", async () => {
  nextId = 10000;
  const original = fixture();
  let project = structuredClone(original);
  let turns = 0, commits = 0;
  const result = await api.runNativeTask({ prompt: "Extract the first clip audio, start it at 1s and 35%; preserve Narration.", mode: "edit", history: [] }, {
    snapshot: () => project, playhead: () => 0, selection: () => ({ clipId: null, textId: null, componentId: null, audioId: null }),
    prepare, progress: () => {}, report: () => {}, observe: async () => { throw Error("No inspection needed"); },
    commit: batch => { commits++; project = batch.project; },
    turn: async input => {
      assert.deepEqual(project, original, "Every candidate remains private until completion");
      parseNativeTurnRequest(input);
      if (turns++ === 0) return { message: "Preparing", observations: [], operations: [
        { kind: "audio.extract", sceneId: "main", clipId: 11 },
        { kind: "audio.update", sceneId: "main", audioId: 301, changes: { start: 1, gain: 0.35 } },
      ] };
      if (turns === 2) {
        const created = input.execution.receipts[0].changes.find(change => !change.before && change.after.kind === "audio");
        const baseline = entity(input.execution, "audio", 301).state.values;
        return { message: "Correcting the audio targets", observations: [], operations: [
          { kind: "audio.update", sceneId: "main", audioId: 301, changes: { start: baseline.start, gain: baseline.gain } },
          { kind: "audio.update", sceneId: "main", audioId: created.after.values.id, changes: { start: 1, gain: 0.35 } },
        ] };
      }
      assert.equal(input.execution.receipts.length, 4);
      assert.equal(entity(input.execution, "audio", 301).state.values.start, 6);
      assert.equal(input.project.scenes[0].audioClips.find(audio => audio.id === 301).start, 6);
      return { message: "Ready", observations: [], operations: [] };
    },
  }, new AbortController().signal);
  assert.equal(commits, 1);
  assert.deepEqual(project.scenes[0].audioClips[0], original.scenes[0].audioClips[0]);
  assert.equal(project.scenes[0].audioClips[1].start, 1);
  assert.equal(project.scenes[0].audioClips[1].gain, 0.35);
  assert.deepEqual(result.batch.before, original);
});

test("relative-edit baseline stays fixed across subsequent changes and receipt context survives history budgeting", async () => {
  nextId = 10000;
  const original = fixture();
  const first = await prepare(original, [{ kind: "text.update", sceneId: "main", textId: 201, changes: { start: 3, end: 5 } }]);
  const second = await prepare(first.project, [{ kind: "text.update", sceneId: "main", textId: 201, changes: { text: "Updated title" } }]);
  const execution = api.nativeExecutionContext(original, [...first.receipts, ...second.receipts]);
  assert.equal(entity(execution, "text", 201).state.values.start, 2);
  assert.equal(execution.receipts[0].changes.find(change => change.after.kind === "text").after.values.start, 3);
  const input = request(second.project, execution);
  const { history: _history, ...fixed } = input;
  const history = Array.from({ length: 20 }, () => ({ role: "assistant", content: "Unrelated previous details ".repeat(900) }));
  const selected = api.assistantContextHistory(fixed, history);
  const wire = { ...fixed, history: selected };
  assert.doesNotThrow(() => parseNativeTurnRequest(wire));
  assert.deepEqual(wire.execution, execution);
  const messages = nativeMessages(wire, []);
  assert.deepEqual(JSON.parse(messages[1].content).execution, execution);
  assert.match(messages.at(-1).content, /ONCE from requestStartValues/);
  const verboseReceipt = structuredClone(execution.receipts[0]);
  verboseReceipt.changes[0].after.values.text = "x".repeat(4000);
  const oversized = { ...fixed, execution: { ...execution, receipts: Array(20).fill(verboseReceipt) } };
  assert.throws(() => api.assistantContextHistory(oversized, []), error => error.status === 413,
    "Execution facts cannot silently disappear to fit conversation history");
});

test("receipts distinguish scheduled effects and no-op preparation, and reject inconsistent or private wire values", async () => {
  nextId = 10000;
  const original = fixture();
  const batch = await prepare(original, [{ kind: "project.ratio", ratio: "9:16" }, { kind: "playback.pause" },
    { kind: "playback.seek", sceneId: "main", time: 4.5 }, { kind: "export.prepare", format: "pvo" }]);
  assert.deepEqual(batch.receipts.map(receipt => receipt.outcome), ["unchanged", "scheduled", "scheduled", "scheduled"]);
  assert.deepEqual(batch.receipts[2].effect, { kind: "playback.seek", sceneId: "main", time: 4.5 });
  assert.deepEqual(batch.receipts[3].effect, { kind: "export.prepare", format: "pvo" });
  assert(batch.receipts.every(receipt => receipt.changes.length === 0));
  const input = request(batch.project, api.nativeExecutionContext(original, batch.receipts));
  assert.doesNotThrow(() => parseNativeTurnRequest(input));
  const invalid = structuredClone(input);
  invalid.execution.receipts[0].outcome = "prepared";
  assert.throws(() => parseNativeTurnRequest(invalid), /outcome/);
  const missingParameters = structuredClone(input);
  delete missingParameters.execution.receipts[2].effect;
  assert.throws(() => parseNativeTurnRequest(missingParameters), /exact effect/);
  const privateInput = structuredClone(input);
  privateInput.execution.requestStartValues[0].state.values.url = "blob:private";
  assert.throws(() => parseNativeTurnRequest(privateInput), /unsupported/);
});

test("authoritative component summaries include all content and type-correct edit keys during completion", () => {
  const input = request(fixture());
  input.project.scenes[0].components = [{ id: "card", type: "card", at: 7, duration: 2, x: 50, y: 50,
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" }, label: "Keep going",
    content: { title: "Keep going", body: "The ending is close.", button0: "Continue" } }];
  const messages = nativeCompletionMessages(nativeMessages(input, []), { message: "Content is missing", operations: [], observations: [] }, input);
  const line = messages.at(-1).content.split("\n").find(line => line.startsWith("Current component values"));
  const component = JSON.parse(line.slice(line.indexOf(": ") + 2))[0];
  assert.deepEqual(component.content, input.project.scenes[0].components[0].content);
  assert.deepEqual(component.editableContentKeys, ["title", "body", "buttonLabels"]);
  assert.match(messages.at(-1).content, /submitLabel belongs only to forms, not cards/);
  assert.match(messages[0].content, /no operation can establish the requested property/);
});
