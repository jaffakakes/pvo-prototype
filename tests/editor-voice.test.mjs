import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/assistant/voice/recognitionSession.ts"],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createRecognitionSession } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function fixture(t, { prefixed = false } = {}) {
  const priorWindow = globalThis.window;
  const events = { phases: [], transcripts: [], sent: [], failures: [], cancelled: 0 };
  let recognition;
  class FakeRecognition {
    constructor() { recognition = this; }
    startCount = 0;
    stopCount = 0;
    abortCount = 0;
    start() { this.startCount++; if (this.startError) throw this.startError; }
    stop() { this.stopCount++; if (this.stopError) throw this.stopError; }
    abort() { this.abortCount++; }
    begin() { this.onstart?.(); }
    result(items) {
      this.onresult?.({ results: items.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
    }
    end() { this.onend?.(); }
  }
  globalThis.window = prefixed ? { webkitSpeechRecognition: FakeRecognition } : { SpeechRecognition: FakeRecognition };
  t.after(() => { globalThis.window = priorWindow; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createRecognitionSession({
    onPhase: value => events.phases.push(value),
    onTranscript: value => events.transcripts.push(value),
    onSend: value => events.sent.push(value),
    onCancel: () => events.cancelled++,
    onFailure: value => events.failures.push(value),
  }, "en-GB");
  assert(session);
  return { session, events, recognition, tick: ms => t.mock.timers.tick(ms) };
}

test("voice release waits for final words and sends one request after recognition ends", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start();
  assert.equal(recognition.startCount, 1);
  assert.equal(recognition.lang, "en-GB");
  assert.equal(recognition.interimResults, true);
  assert.deepEqual(events.transcripts, [""]);
  recognition.begin();
  recognition.result([["make it blue", false]]);
  assert.deepEqual(events.sent, []);
  session.release();
  assert.equal(recognition.stopCount, 1);
  assert.deepEqual(events.sent, []);
  recognition.result([["make it brighter", true]]);
  recognition.end();
  tick(149);
  assert.deepEqual(events.sent, []);
  tick(1);
  assert.deepEqual(events.sent, ["make it brighter"]);
  session.release();
  session.cancel();
  tick(6000);
  assert.equal(events.cancelled, 0);
  assert.equal(events.sent.length, 1);
  assert.equal(recognition.onresult, null);
});

test("voice interim revisions preserve cumulative final sentences without sending before release", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin();
  recognition.result([["add a", false]]);
  recognition.result([["add a button", true], ["and", false]]);
  recognition.result([["add a button", true], ["and make it green", true]]);
  recognition.end();
  tick(1000);
  assert.deepEqual(events.sent, []);
  assert.equal(events.transcripts.at(-1), "add a button and make it green");
  session.release(); tick(150);
  assert.deepEqual(events.sent, ["add a button and make it green"]);
});

test("voice accepts a final result delivered just after the end event", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin(); session.release(); recognition.end();
  tick(75);
  recognition.result([["delayed words", true]]);
  tick(149);
  assert.deepEqual(events.sent, []);
  tick(1);
  assert.deepEqual(events.sent, ["delayed words"]);
});

test("releasing before microphone start aborts now and guards a late permission resolution", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); session.release();
  assert.equal(events.cancelled, 1);
  assert.equal(recognition.abortCount, 1);
  recognition.begin();
  assert.equal(recognition.abortCount, 2);
  recognition.result([["never send", true]]);
  recognition.end();
  assert.equal(recognition.onstart, null);
  tick(15000);
  assert.deepEqual(events.sent, []);
  assert.equal(events.cancelled, 1);
});

test("permission denial cancels once, reports its cause, and ignores later events", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start();
  recognition.onerror({ error: "not-allowed" });
  session.release(); recognition.end(); tick(15000);
  assert.equal(events.cancelled, 1);
  assert.equal(events.failures[0].reason, "denied");
  assert.equal(events.failures.length, 1);
  assert.deepEqual(events.sent, []);
});

test("cancelling a voice attempt discards final words and releases recognition listeners", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin(); recognition.result([["discard me", true]]);
  session.cancel(); recognition.end(); tick(5000);
  assert.equal(events.cancelled, 1);
  assert.deepEqual(events.sent, []);
  assert.deepEqual(events.failures, [], "Explicit cancellation must not produce a notification reason");
  assert.equal(recognition.onresult, null);
  assert.equal(recognition.onerror, null);
  assert.equal(recognition.onstart, null);
  assert.equal(recognition.onend, null);
});

test("interim-only speech cannot be submitted as a completed request", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin(); recognition.result([["uncertain", false]]);
  session.release(); recognition.end(); tick(150);
  assert.equal(events.cancelled, 1);
  assert.equal(events.failures[0].reason, "holdShort");
  assert.deepEqual(events.sent, []);
});

test("a one-word final transcript returns to the previous phase without submitting", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin(); recognition.result([["blue", true]]);
  session.release(); recognition.end(); tick(150);
  assert.equal(events.cancelled, 1);
  assert.equal(events.failures[0].reason, "holdShort");
  assert.deepEqual(events.sent, []);
  assert.equal(recognition.onresult, null);
});

test("microphone startup has a bounded wait and a late-start abort guard", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); tick(10000);
  assert.equal(events.cancelled, 1);
  assert.equal(events.failures[0].reason, "failed");
  assert.match(events.failures[0].detail, /timed out/);
  assert.equal(recognition.abortCount, 1);
  recognition.end();
});

test("missing end events have a bounded wait before submitting final words and aborting", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin(); recognition.result([["use this final", true]]);
  session.release(); tick(5000);
  assert.deepEqual(events.sent, ["use this final"]);
  assert.equal(recognition.abortCount, 1);
  recognition.end();
});

test("synchronous browser start failure clears the pending attempt", t => {
  const { session, events, recognition, tick } = fixture(t);
  recognition.startError = new DOMException("blocked", "NotAllowedError");
  session.start(); recognition.end(); tick(15000);
  assert.equal(events.cancelled, 1);
  assert.equal(events.failures[0].reason, "denied");
  assert.deepEqual(events.sent, []);
});

test("synchronous browser stop failure cannot send a stale request", t => {
  const { session, events, recognition, tick } = fixture(t);
  session.start(); recognition.begin(); recognition.result([["do not send", true]]);
  recognition.stopError = new Error("broken");
  session.release(); recognition.end(); tick(15000);
  assert.equal(events.cancelled, 1);
  assert.deepEqual(events.sent, []);
});

test("voice supports the prefixed browser API and explicitly detects absent recognition", t => {
  const { session, recognition } = fixture(t, { prefixed: true });
  session.cancel(); recognition.end();
  globalThis.window = {};
  assert.equal(createRecognitionSession({}, "en"), null);
});

for (const [browserError, reason] of [
  ["audio-capture", "noMicrophone"], ["no-speech", "noSpeech"],
  ["network", "network"], ["service-not-allowed", "denied"], ["unknown-error", "failed"],
]) {
  test(`voice maps ${browserError} to one typed ${reason} failure`, t => {
    const { session, events, recognition, tick } = fixture(t);
    session.start(); recognition.begin();
    recognition.onerror({ error: browserError });
    recognition.end(); session.release(); tick(15000);
    assert.deepEqual(events.failures, [{ reason, detail: browserError }]);
    assert.equal(events.cancelled, 1);
    assert.deepEqual(events.sent, []);
  });
}
