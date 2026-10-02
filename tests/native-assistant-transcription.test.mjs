import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { parseTranscriptionResult } from "../server/assistant/native/audio.js";
import { validateNativeResult } from "../server/assistant/native/policy.js";
import { nativeInput } from "./native-assistant-server.helpers.mjs";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/infrastructure/assistant/media/transcript.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const { transcribeAssistantAudio } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("transcription endpoint never clamps an out-of-range segment into inverted timestamps", () => {
  assert.throws(() => parseTranscriptionResult({ text: "Too late", segments: [
    { start: 1.01, end: 1.04, text: "Too late" },
  ] }, 1), error => error.status === 422);
  assert.deepEqual(parseTranscriptionResult({ text: "At the end", segments: [
    { start: 0.8, end: 1.04, text: "At the end" },
  ] }, 1), { text: "At the end", segments: [{ start: 0.8, end: 1, text: "At the end" }] });
});

test("transcription maps real segment times to scene time and rejects starts beyond the inspected window", async () => {
  globalThis.location = new URL("http://localhost/editor/");
  globalThis.OfflineAudioContext = class {
    destination = {};
    async decodeAudioData() { return { duration: 8, numberOfChannels: 1 }; }
    createBufferSource() {
      return { buffer: null, playbackRate: {}, connect: target => target, start() {}, stop() {}, disconnect() {} };
    }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(16000) }; }
  };
  const project = { ratio: "16:9", scenes: [{ id: "main", name: "Main", parent: null,
    clips: [{ id: 1, url: "blob:http://localhost/source", srcDur: 8, in: 1, out: 8, speed: 2 }],
    texts: [], components: [], sound: 0, muted: false }] };
  const request = { kind: "transcript", sceneId: "main", start: 2, end: 3 };
  let result = { text: "The answer", segments: [{ start: 0.2, end: 1.04, text: "The answer" }] };
  let status = 200;
  const send = async url => url === "/api/assistant/transcribe"
    ? Response.json(result, { status }) : new Response(new Uint8Array([1, 2, 3]));
  try {
    const observed = await transcribeAssistantAudio(project, request, { fetch: send });
    assert.deepEqual(observed.segments, [{ start: 2.2, end: 3, text: "The answer" }]);
    result = { text: "Too late", segments: [{ start: 1.01, end: 1.04, text: "Too late" }] };
    await assert.rejects(transcribeAssistantAudio(project, request, { fetch: send }), /invalid timestamps/);
    status = 429;
    result = { code: "provider_allowance_exhausted", error: "private provider allowance message" };
    await assert.rejects(transcribeAssistantAudio(project, request, { fetch: send }), error => {
      assert.equal(error.name, "AssistantServiceError");
      assert.equal(error.status, 429);
      assert.equal(error.code, "provider_allowance_exhausted");
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
  } finally {
    delete globalThis.OfflineAudioContext;
    delete globalThis.location;
  }
});

test("client transcription allows the server cold-start deadline then cancels a stalled request", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.location = new URL("http://localhost/editor/");
  globalThis.OfflineAudioContext = class {
    destination = {};
    async decodeAudioData() { return { duration: 2, numberOfChannels: 1 }; }
    createBufferSource() {
      return { buffer: null, playbackRate: {}, connect: target => target, start() {}, stop() {}, disconnect() {} };
    }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(16000) }; }
  };
  const project = { ratio: "16:9", scenes: [{ id: "main", name: "Main", parent: null,
    clips: [{ id: 1, url: "blob:http://localhost/source", srcDur: 2, in: 0, out: 2, speed: 1 }],
    texts: [], components: [], sound: 0, muted: false }] };
  let ready;
  let upstreamSignal;
  const started = new Promise(resolve => { ready = resolve; });
  const send = async (url, options) => {
    if (url !== "/api/assistant/transcribe") return new Response(new Uint8Array([1, 2, 3]));
    upstreamSignal = options.signal;
    ready();
    return new Promise(() => {});
  };
  try {
    const pending = transcribeAssistantAudio(project, { kind: "transcript", sceneId: "main", start: 0, end: 1 }, { fetch: send });
    const rejected = assert.rejects(pending, /Audio transcription timed out/);
    await started;
    context.mock.timers.tick(90000);
    assert.equal(upstreamSignal.aborted, false, "A server job can use its full 90-second cold-start deadline");
    context.mock.timers.tick(5000);
    await rejected;
    assert.equal(upstreamSignal.aborted, true, "The client still ends a stalled request after 95 seconds");
  } finally {
    delete globalThis.OfflineAudioContext;
    delete globalThis.location;
    context.mock.timers.reset();
  }
});

test("coarse speech timing can be refined through a substantially narrower transcript window", async () => {
  const input = nativeInput();
  const transcript = { kind: "transcript", sceneId: "main", start: 0, end: 10, text: "A setup, then the answer." };
  const request = { message: "Locate when the answer is spoken.", operations: [], observations: [
    { kind: "transcript", sceneId: "main", start: 6, end: 10 },
  ] };
  for (const timing of [undefined, [], [{ start: 0.2, end: 9.8, text: transcript.text }]]) {
    input.observations = [{ ...transcript, ...(timing ? { segments: timing } : {}) }];
    await validateNativeResult(input, request);
  }
  input.observations = [{ ...transcript, segments: [{ start: 0.2, end: 9.8, text: transcript.text }] }];
  for (const [start, end] of [[0, 10], [1, 9]]) {
    await assert.rejects(validateNativeResult(input, { ...request, observations: [
      { kind: "transcript", sceneId: "main", start, end },
    ] }), /already supplied/);
  }
});

test("transcript refinement does not repeat silent, already precise or exact observed ranges", async () => {
  const input = nativeInput();
  const broad = { kind: "transcript", sceneId: "main", start: 0, end: 10, text: "The answer.", segments: [] };
  const narrow = { ...broad, start: 6, end: 10 };
  const request = { message: "Locate the answer.", operations: [], observations: [
    { kind: "transcript", sceneId: "main", start: 6, end: 10 },
  ] };
  for (const observations of [
    [{ ...broad, text: "" }],
    [{ ...broad, segments: [{ start: 6.5, end: 7.5, text: "The answer." }] }],
    [{ ...broad, segments: [{ start: 0, end: 4, text: "The answer." }] }],
    [broad, narrow],
  ]) {
    input.observations = observations;
    await assert.rejects(validateNativeResult(input, request), /already supplied/);
  }
  input.observations = [{ ...broad, start: 0, end: 0.001 }];
  await assert.rejects(validateNativeResult(input, { ...request, observations: [
    { kind: "transcript", sceneId: "main", start: 0, end: 0.001 },
  ] }), /already supplied/, "Even very short exact duplicates remain blocked");
});
