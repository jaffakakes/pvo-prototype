import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { parseTranscriptionAudio } from "../server/assistant/native/audio.js";

async function load(path) {
  const result = buildSync({ entryPoints: [path], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { captureMicrophone } = await load("editor/src/infrastructure/assistant/microphoneCapture.ts");
const { microphoneWav, transcribeMicrophone } = await load("editor/src/infrastructure/assistant/microphoneTranscription.ts");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function globals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => prior ? Object.defineProperty(globalThis, name, prior) : delete globalThis[name]);
  }
}
function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let accept, deny, recorder;
  const track = new EventTarget();
  track.stops = 0; track.readyState = "live"; track.stop = () => { track.stops++; track.readyState = "ended"; };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recorder {
    state = "inactive"; mimeType = "audio/mp4"; stops = 0;
    constructor() { recorder = this; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.stops++; }
    finish() { this.ondataavailable?.({ data: new Blob(["sound"]) }); this.onstop?.(); }
  }
  globals(t, { navigator: { mediaDevices: { getUserMedia: () => new Promise((a, b) => { accept = a; deny = b; }) } },
    MediaRecorder: Recorder, OfflineAudioContext: class {} });
  const controller = new AbortController();
  let started = 0;
  const capture = captureMicrophone(controller.signal, () => started++);
  return { capture, controller, track, stream, recorder: () => recorder, accept: () => accept(stream), deny: error => deny(error),
    started: () => started, tick: ms => t.mock.timers.tick(ms) };
}

test("cancelled permission discards a late stream and stops all tracks", async t => {
  const f = fixture(t); const rejected = assert.rejects(f.capture.result, { name: "AbortError" });
  f.controller.abort(); await rejected; f.accept(); await flush();
  assert.equal(f.track.stops, 1); assert.equal(f.recorder(), undefined); assert.equal(f.started(), 0);
});

test("permission denial returns its typed browser reason", async t => {
  const f = fixture(t); const rejected = assert.rejects(f.capture.result, { name: "NotAllowedError" });
  f.deny(new DOMException("Denied", "NotAllowedError")); await rejected;
});

test("recording starts only on the recorder event and cleans tracks/listeners on stop", async t => {
  const f = fixture(t); f.accept(); await flush();
  assert.equal(f.started(), 0); f.recorder().onstart(); assert.equal(f.started(), 1);
  f.capture.stop(); f.recorder().finish();
  assert.equal((await f.capture.result).size, 5); assert.equal(f.track.stops, 1);
  assert.equal(f.recorder().ondataavailable, null); assert.equal(f.recorder().onstop, null);
  f.tick(120000); assert.equal(f.recorder().stops, 1);
});

test("capture stops at sixty seconds and missing stop events time out", async t => {
  const f = fixture(t); f.accept(); await flush(); f.recorder().onstart();
  f.tick(59999); assert.equal(f.recorder().stops, 0); f.tick(1); assert.equal(f.recorder().stops, 1);
  const rejected = assert.rejects(f.capture.result, /did not finish/); f.tick(5000); await rejected;
  assert.equal(f.track.stops, 1);
});

test("cancellation while recording releases the stream immediately and discards audio", async t => {
  const f = fixture(t); f.accept(); await flush(); f.recorder().onstart();
  const rejected = assert.rejects(f.capture.result, { name: "AbortError" }); f.controller.abort(); await rejected;
  assert.equal(f.track.stops, 1); assert.equal(f.recorder().state, "inactive");
  f.recorder().finish(); assert.equal(f.recorder().onstop, null);
});

test("a disconnected microphone fails without retaining tracks or timers", async t => {
  const f = fixture(t); f.accept(); await flush(); f.recorder().onstart();
  const rejected = assert.rejects(f.capture.result, { name: "NotReadableError" }); f.track.dispatchEvent(new Event("ended")); await rejected;
  assert.equal(f.track.stops, 1); f.tick(120000); assert.equal(f.recorder().stops, 1);
});

test("encoded capture size is bounded and fails before decoding", async t => {
  const f = fixture(t); f.accept(); await flush(); f.recorder().onstart();
  const rejected = assert.rejects(f.capture.result, /size limit/);
  f.recorder().ondataavailable({ data: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) }); await rejected;
  assert.equal(f.track.stops, 1);
});

function decoder(t, { silent = false, length = 16000 } = {}) {
  const lifecycle = { disconnected: 0, stopped: 0 };
  globals(t, { OfflineAudioContext: class {
    constructor(channels, count, rate) { assert.equal(channels, 1); assert.equal(rate, 16000); this.length = count; this.destination = {}; }
    async decodeAudioData() { return { length }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() { lifecycle.stopped++; }, disconnect() { lifecycle.disconnected++; } }; }
    async startRendering() { return { getChannelData: () => new Float32Array(this.length).fill(silent ? 0 : 0.1) }; }
  } });
  return lifecycle;
}

test("microphone conversion emits bounded mono 16 kHz PCM WAV accepted by server", async t => {
  const life = decoder(t, { length: 61 * 16000 });
  const audio = await microphoneWav(new Blob(["encoded"]), new AbortController().signal);
  assert.equal(audio.duration, 60);
  assert.deepEqual(parseTranscriptionAudio(new Uint8Array(audio.wav)), { duration: 60 });
  assert.equal(life.stopped, 1); assert.equal(life.disconnected, 1);
});

test("silence does not call transcription", async t => {
  decoder(t, { silent: true }); let calls = 0;
  const text = await transcribeMicrophone(new Blob(["encoded"]), new AbortController().signal, async () => { calls++; });
  assert.equal(text, ""); assert.equal(calls, 0);
});

test("transcription uses the bounded same-origin WAV contract", async t => {
  decoder(t);
  const text = await transcribeMicrophone(new Blob(["encoded"]), new AbortController().signal, async (url, options) => {
    assert.equal(url, "/api/assistant/transcribe"); assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "same-origin"); assert.equal(options.headers["Content-Type"], "audio/wav");
    assert.equal(options.headers["X-Audio-Duration"], "1");
    assert.deepEqual(parseTranscriptionAudio(new Uint8Array(options.body)), { duration: 1 });
    return Response.json({ text: "Bolder", segments: [] });
  });
  assert.equal(text, "Bolder");
});

test("provider quota errors keep their classification without retries", async t => {
  decoder(t); let calls = 0;
  await assert.rejects(transcribeMicrophone(new Blob(["encoded"]), new AbortController().signal, async () => {
    calls++; return Response.json({ code: "provider_allowance_exhausted" }, { status: 429 });
  }), error => error.status === 429 && error.code === "provider_allowance_exhausted");
  assert.equal(calls, 1);
});

test("aborting a network request rejects promptly even when fetch ignores its signal", async t => {
  decoder(t); const controller = new AbortController(); let started;
  const fetched = new Promise(resolve => { started = resolve; });
  const result = transcribeMicrophone(new Blob(["encoded"]), controller.signal, async () => { started(); return new Promise(() => {}); });
  const rejected = assert.rejects(result, { name: "AbortError" }); await fetched; controller.abort(); await rejected;
});

test("transcription has a ninety-five second deadline with a typed timeout", async t => {
  decoder(t); t.mock.timers.enable({ apis: ["setTimeout"] }); let started;
  const fetched = new Promise(resolve => { started = resolve; });
  const result = transcribeMicrophone(new Blob(["encoded"]), new AbortController().signal, async () => { started(); return new Promise(() => {}); });
  const rejected = assert.rejects(result, error => error.status === 504);
  await fetched; t.mock.timers.tick(95000); await rejected;
});
