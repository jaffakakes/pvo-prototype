import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["editor/src/features/assistant/voice/voiceSession.ts"],
  bundle: true, write: false, format: "esm", platform: "browser" });
const { createVoiceSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const audio = deferred();
  const response = deferred();
  const events = { phases: [], sent: [], failures: [], cancelled: 0, stops: 0, uploads: 0, captures: 0 };
  let begin, signal;
  const session = createVoiceSession({
    onPhase: phase => events.phases.push(phase), onTranscript: () => {},
    onSend: text => events.sent.push(text), onCancel: () => events.cancelled++, onFailure: error => events.failures.push(error),
  }, {
    capture: (abort, ready) => { events.captures++; signal = abort; begin = ready; return { result: audio.promise, stop: () => events.stops++ }; },
    transcribe: async (_, abort) => { assert.equal(abort, signal); events.uploads++; return response.promise; },
    available: async () => {}, ...options,
  });
  return { session, events, audio, response, signal: () => signal, begin: () => begin(), tick: ms => t.mock.timers.tick(ms) };
}

async function recording(f) { f.session.start(); await flush(); f.begin(); }

test("hold release stops capture, uploads once, and sends only the completed transcript", async t => {
  const f = fixture(t);
  await recording(f);
  assert.equal(f.events.phases.at(-1), "listening");
  assert.equal(f.events.uploads, 0);
  f.session.release();
  assert.equal(f.events.stops, 1);
  assert.equal(f.events.phases.at(-1), "transcribing");
  f.audio.resolve(new Blob(["encoded audio"])); await flush();
  assert.equal(f.events.uploads, 1);
  assert.deepEqual(f.events.sent, []);
  f.response.resolve("make it blue"); await flush();
  assert.deepEqual(f.events.sent, ["make it blue"]);
  f.session.release(); f.session.cancel();
  assert.equal(f.events.uploads, 1);
  assert.equal(f.events.cancelled, 0);
});

test("a recording reaching its cap waits for explicit Send before uploading", async t => {
  const f = fixture(t, { minimumWords: 1 }); await recording(f);
  f.audio.resolve(new Blob(["bounded recording"])); await flush();
  assert.equal(f.events.phases.at(-1), "ready");
  f.tick(120000);
  assert.equal(f.events.uploads, 0);
  f.session.release(); await flush();
  f.response.resolve("Bolder"); await flush();
  assert.deepEqual(f.events.sent, ["Bolder"]);
});

test("hold release before microphone permission completes aborts without uploading", async t => {
  const f = fixture(t); f.session.start(); await flush(); f.session.release();
  assert.equal(f.signal().aborted, true);
  f.begin(); f.audio.resolve(new Blob(["late recording"])); await flush();
  assert.equal(f.events.uploads, 0);
  assert.equal(f.events.cancelled, 1);
  assert.equal(f.events.failures[0].reason, "holdShort");
  assert.deepEqual(f.events.sent, []);
});

test("cancellation during transcription aborts and ignores a late successful response", async t => {
  const f = fixture(t); await recording(f); f.session.release();
  f.audio.resolve(new Blob(["audio"])); await flush();
  assert.equal(f.events.uploads, 1);
  f.session.cancel(); assert.equal(f.signal().aborted, true);
  f.response.resolve("never apply this"); await flush();
  assert.deepEqual(f.events.sent, []);
  assert.deepEqual(f.events.failures, []);
  assert.equal(f.events.cancelled, 1);
});

test("cancel after capture ends discards audio without contacting transcription", async t => {
  const f = fixture(t); await recording(f);
  f.audio.resolve(new Blob(["audio"])); await flush(); f.session.cancel(); f.session.release();
  assert.equal(f.events.uploads, 0);
  assert.deepEqual(f.events.sent, []);
});

test("permission startup times out and ignores late completion", async t => {
  const f = fixture(t); f.session.start(); await flush(); f.tick(29999);
  assert.equal(f.events.cancelled, 0); f.tick(1);
  assert.equal(f.signal().aborted, true); f.begin(); await flush();
  assert.equal(f.events.phases.at(-1), "idle");
  assert.match(f.events.failures[0].detail, /timed out/);
});

test("unavailable server transcription fails before requesting microphone permission", async t => {
  const f = fixture(t, { available: async () => { throw new Error("Transcription unavailable"); } });
  f.session.start(); await flush();
  assert.equal(f.events.captures, 0); assert.equal(f.events.uploads, 0);
  assert.equal(f.events.cancelled, 1);
});

test("cancel during availability preflight prevents later capture", async t => {
  const pending = deferred();
  const f = fixture(t, { available: () => pending.promise });
  f.session.start(); f.session.cancel(); pending.resolve(); await flush();
  assert.equal(f.events.captures, 0); assert.equal(f.events.uploads, 0);
});

for (const [name, reason] of [["NotAllowedError", "denied"], ["NotFoundError", "noMicrophone"],
  ["NotReadableError", "noMicrophone"], ["NotSupportedError", "unavailable"]]) {
  test(`microphone ${name} reports one ${reason} failure`, async t => {
    const f = fixture(t); f.session.start(); await flush();
    f.audio.reject(new DOMException("device error", name)); await flush(); f.session.release();
    assert.equal(f.events.failures.length, 1); assert.equal(f.events.failures[0].reason, reason);
    assert.equal(f.events.cancelled, 1); assert.deepEqual(f.events.sent, []);
  });
}

for (const [minimumWords, text, reason] of [[2, "Bolder", "holdShort"], [1, "", "noSpeech"], [2, "  ", "noSpeech"]]) {
  test(`voice rejects ${JSON.stringify(text)} with minimum ${minimumWords} as ${reason}`, async t => {
    const f = fixture(t, { minimumWords }); await recording(f); f.session.release();
    f.audio.resolve(new Blob(["audio"])); await flush(); f.response.resolve(text); await flush();
    assert.equal(f.events.failures[0].reason, reason); assert.deepEqual(f.events.sent, []);
  });
}

test("capture failure stops the pending session and cannot submit later audio", async t => {
  const f = fixture(t); await recording(f); f.audio.reject(new Error("Recorder failed")); await flush();
  f.session.release(); assert.equal(f.events.cancelled, 1); assert.equal(f.events.uploads, 0);
});
