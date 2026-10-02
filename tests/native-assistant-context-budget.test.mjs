import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { validateNativeInput } from "../server/assistant/native/policy.js";

const bundle = buildSync({
  stdin: { contents: "export * from './editor/src/infrastructure/assistant/contextBudget.ts';", resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { assistantContextHistory, retainAssistantEvidence, retainAssistantHistory } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function context() {
  return {
    mode: "plan", prompt: "Use the footage to finish the edit.", observations: [],
    project: { fingerprint: "fixture", currentSceneId: "main", selection: {
      clipId: null, textId: null, audioId: null, componentId: null,
    }, playhead: 0, ratio: "9:16", canvas: { width: 1080, height: 1920 }, scenes: [{
      id: "main", name: "Main", parent: null, duration: 10, muted: false, musicGain: 1, clipGain: 1,
      clips: [], texts: [], audioClips: [], components: [],
    }] },
  };
}

test("wire history respects the real server byte limit with non-ASCII evidence and escaping", () => {
  const input = context();
  input.project.scenes[0].texts = [{ id: 1, text: "Current authored copy ".repeat(1000), start: 0, end: 2, x: 50, y: 50 }];
  const history = Array.from({ length: 20 }, (_, index) => ({ role: "assistant",
    content: "Observed evidence " + index + ": " + '🎬你好\\"\n'.repeat(1800) }));
  const original = structuredClone({ input, history });
  const selected = assistantContextHistory(input, history);
  const request = { ...input, history: selected };
  assert(bytes(request) <= 48 * 1024);
  assert.doesNotThrow(() => validateNativeInput(request));
  assert(selected.length <= 12 && selected.length > 0);
  assert.match(selected.at(-1).content, /^Observed evidence 19:/);
  assert(selected.every(item => item.content.length <= 8000 && item.content.isWellFormed()));
  assert.deepEqual({ input, history }, original, "Budgeting cannot mutate the project, prompt or source messages");
  assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
});

test("current transcripts reserve bytes and raw frames keep their independent image budget", () => {
  const input = context();
  input.observations = [
    { kind: "transcript", sceneId: "main", start: 0, end: 10, text: "Spoken words ".repeat(1800) },
    { kind: "frames", sceneId: "main", start: 0, end: 1, coverage: "video-and-text", note: "Video sample",
      frames: [{ sceneTime: 0.5, clipId: null, sourceTime: null, width: 64, height: 64,
        dataUrl: "data:image/jpeg;base64," + "A".repeat(100000) }] },
  ];
  const history = Array.from({ length: 12 }, (_, index) => ({ role: "assistant", content: index + ": " + "detail ".repeat(1100) }));
  const original = structuredClone(input);
  const selected = assistantContextHistory(input, history);
  assert(selected.length > 0, "Image payloads must not consume the separate textual budget");
  assert.doesNotThrow(() => validateNativeInput({ ...input, history: selected }));
  assert.deepEqual(input, original, "Current observations must remain exact");
});

test("oversized fixed context fails explicitly instead of silently dropping the current task", () => {
  const input = context();
  input.project.scenes[0].texts = [{ id: 1, text: "字".repeat(20000), start: 0, end: 2, x: 50, y: 50 }];
  const original = structuredClone(input);
  assert.throws(() => assistantContextHistory(input, [{ role: "user", content: "Earlier question" }]),
    error => error.status === 413);
  assert.deepEqual(input, original);
});

test("session retention has aggregate byte bounds, keeps recent labels and preserves short earlier evidence", () => {
  const evidence = [
    { scope: "audio", fingerprint: "same", content: "Observed main at 0s: the opening line." },
    { scope: "audio", fingerprint: "same", content: "Observed main at 1s: " + "🎬".repeat(8000) },
    { scope: "audio", fingerprint: "same", content: "Observed main at 2s: " + '"\\'.repeat(8000) },
  ];
  const retained = retainAssistantEvidence(evidence);
  assert(bytes(retained) <= 16 * 1024);
  assert.equal(retained.length, 3);
  assert.deepEqual(retained[0], evidence[0]);
  assert.match(retained.at(-1).content, /^Observed main at 2s:/);
  assert(retained.every(item => item.scope === "audio" && item.fingerprint === "same" && item.content.isWellFormed()));

  const many = Array.from({ length: 30 }, (_, index) => ({ role: "assistant", content: index + ": " + "🎬".repeat(8000) }));
  const history = retainAssistantHistory(many);
  assert(bytes(history) <= 16 * 1024 && history.length <= 12);
  assert.match(history.at(-1).content, /^29:/);
  assert(history.every(item => item.content.length <= 8000 && item.content.isWellFormed()));
  assert(bytes(retainAssistantEvidence(many.map(item => ({ scope: "audio", fingerprint: "same", content: item.content })))) <= 16 * 1024);
});

test("a near-full project drops dispensable history and retains exact project data", () => {
  const input = context();
  input.project.scenes[0].texts = [{ id: 1, text: "x", start: 0, end: 2, x: 50, y: 50 }];
  const fixedSize = bytes({ ...input, history: [] });
  input.project.scenes[0].texts[0].text += "x".repeat(48 * 1024 - fixedSize - 1);
  const history = assistantContextHistory(input, [{ role: "user", content: "Earlier question" }]);
  assert.deepEqual(history, []);
  assert.doesNotThrow(() => validateNativeInput({ ...input, history }));
});
