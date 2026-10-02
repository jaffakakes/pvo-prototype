import assert from "node:assert/strict";
import test from "node:test";
import { parseRunpodTranscriptionOutput, runpodTranscriptionConfigured, transcribeRunpodAudio } from "../server/assistant/native/runpodAudio.js";

const env = { RUNPOD_API_KEY: "server-secret", RUNPOD_TRANSCRIPTION_ENDPOINT: "verified-endpoint" };
const input = { audio: "UklGRg==", duration: 5 };
const transcript = { segments: [{ start: 1.2, end: 2.4, text: " Hello world. ",
  words: [{ word: "Hello", start: 1.2, end: 1.6 }, { word: "world.", start: 1.7, end: 2.4 }] }], detected_language: "en" };
const result = { text: "Hello world.", segments: [
  { start: 1.2, end: 1.6, text: "Hello" }, { start: 1.7, end: 2.4, text: "world." },
] };
const controller = () => new AbortController();
function fixture(outputs) {
  const calls = [];
  const send = async (url, options) => {
    calls.push({ url, ...options, ...(options.body ? { payload: JSON.parse(options.body) } : {}) });
    assert.equal(new URL(url).origin, "https://api.runpod.ai");
    assert.equal(options.redirect, "manual", "An API key must never follow a redirect");
    assert.equal(options.headers.Authorization, "Bearer server-secret");
    const output = outputs.shift();
    assert(output, "Every request needs an explicit fixture response");
    return typeof output === "function" ? output(options) : output instanceof Response ? output : Response.json(output);
  };
  return { calls, send, options: { fetch: send, pollMs: 0 } };
}

test("Runpod transcription queues once, requests aligned timestamps, polls and returns canonical native data", async () => {
  const f = fixture([
    { id: "job-1", status: "IN_QUEUE" }, { id: "job-1", status: "IN_PROGRESS" },
    { id: "job-1", status: "COMPLETED", output: transcript },
  ]);
  assert.deepEqual(await transcribeRunpodAudio(env, input, controller().signal, f.options), result);
  assert.deepEqual(f.calls.map(call => [new URL(call.url).pathname, call.method]), [
    ["/v2/verified-endpoint/run", "POST"], ["/v2/verified-endpoint/status/job-1", "GET"],
    ["/v2/verified-endpoint/status/job-1", "GET"],
  ]);
  assert.deepEqual(f.calls[0].payload, {
    input: { audio_file: "data:audio/wav;base64,UklGRg==", align_output: true, diarization: false, batch_size: 16 },
    policy: { executionTimeout: 90000, ttl: 90000 },
  });
  assert.equal(f.calls[1].body, undefined);
  assert(!JSON.stringify(result).includes("server-secret"));
});

test("Runpod output normalizer rejects worker error objects and malformed or oversized timelines", () => {
  const invalid = [
    null, {}, { error: "private-worker-stack", segments: [] }, { segments: {} },
    { segments: Array.from({ length: 301 }, () => transcript.segments[0]) },
    { segments: [{ start: -1, end: 2, text: "Bad" }] },
    { segments: [{ start: 2, end: 1, text: "Bad" }] },
    { segments: [{ start: 2, end: 5.2, text: "Bad" }] },
    { segments: [{ start: 0, end: 2, text: "a".repeat(2001) }] },
    { segments: Array.from({ length: 11 }, () => ({ start: 0, end: 1, text: "a".repeat(2000) })) },
  ];
  for (const output of invalid) assert.throws(() => parseRunpodTranscriptionOutput(output, 5), error => {
    assert.equal(error.status, 422);
    assert(!error.message.includes("private-worker-stack"));
    return true;
  });
  assert.deepEqual(parseRunpodTranscriptionOutput({ segments: [] }, 5), { text: "", segments: [] });
  assert.equal(parseRunpodTranscriptionOutput({ segments: [{ start: 4, end: 5.03, text: "End" }] }, 5).segments[0].end, 5);
});

test("aligned word timing identifies the spoken answer inside a coarse segment without rewriting transcript text", () => {
  const output = { segments: [{ start: 0, end: 10, text: "The answer is: outstanding in his field!", words: [
    { word: "The", start: 0.5, end: 0.7 }, { word: "answer", start: 0.8, end: 1.2 },
    { word: "is:", start: 1.3, end: 1.5 }, { word: "outstanding", start: 7.2, end: 7.8 },
    { word: "in", start: 7.9, end: 8 }, { word: "his", start: 8.1, end: 8.3 },
    { word: "field!", start: 8.4, end: 8.8 },
  ] }] };
  const normalized = parseRunpodTranscriptionOutput(output, 10);
  assert.equal(normalized.text, output.segments[0].text, "Original punctuation and sentence text are preserved");
  assert.deepEqual(normalized.segments.find(item => item.text === "outstanding"), { start: 7.2, end: 7.8, text: "outstanding" });
  assert.equal(normalized.segments.length, 7);
});

test("missing word timing falls back to its complete original segment while other aligned segments stay precise", () => {
  for (const incomplete of [undefined, [], [{ word: "Price" }, { word: "$12", start: 3 }]]) {
    const output = { segments: [transcript.segments[0], {
      start: 3, end: 4, text: "Price $12", ...(incomplete === undefined ? {} : { words: incomplete }),
    }] };
    assert.deepEqual(parseRunpodTranscriptionOutput(output, 5), {
      text: "Hello world. Price $12", segments: [...result.segments, { start: 3, end: 4, text: "Price $12" }],
    });
  }
});

test("malformed supplied word timestamps fail even beside missing timings or beyond the word-detail limit", () => {
  for (const invalid of [
    { word: "Bad", start: -1, end: 1 }, { word: "Bad", start: NaN, end: 1 },
    { word: "Bad", start: 1, end: Infinity }, { word: "Bad", start: 2, end: 1 },
    { word: "Bad", start: null, end: 1 }, { word: "Bad", start: 1, end: 5.2 },
    { word: "Bad", start: 5.01, end: 5.04 }, { word: "Bad", end: -1 },
  ]) {
    for (const prefix of [[{ word: "Untimed" }], Array.from({ length: 301 }, () => ({ word: "Good", start: 0, end: 1 }))]) {
      assert.throws(() => parseRunpodTranscriptionOutput({ segments: [{
        start: 0, end: 5, text: "Keep validation strict", words: [...prefix, invalid],
      }] }, 5), error => error.status === 422);
    }
  }
  for (const words of [null, {}, [null], [{ start: 0, end: 1 }]]) {
    assert.throws(() => parseRunpodTranscriptionOutput({ segments: [{ start: 0, end: 1, text: "Invalid words", words }] }, 5), error => error.status === 422);
  }
});

test("word detail exceeding 300 observations keeps all original segments instead of truncating the ending", () => {
  const words = Array.from({ length: 299 }, (_, index) => ({ word: String(index), start: index / 100, end: (index + 1) / 100 }));
  const opening = { start: 0, end: 3, text: "A long spoken opening", words };
  const ending = { start: 4, end: 5, text: "Final answer", words: [
    { word: "Final", start: 4, end: 4.4 }, { word: "answer", start: 4.5, end: 5 },
  ] };
  assert.deepEqual(parseRunpodTranscriptionOutput({ segments: [opening, ending] }, 5), {
    text: "A long spoken opening Final answer",
    segments: [{ start: 0, end: 3, text: opening.text }, { start: 4, end: 5, text: ending.text }],
  });
  const exact = parseRunpodTranscriptionOutput({ segments: [{ ...opening, words: words.slice(1) }, ending] }, 5);
  assert.equal(exact.segments.length, 300, "Exactly 300 aligned words fit the existing contract");
  assert.deepEqual(exact.segments.at(-1), { start: 4.5, end: 5, text: "answer" });
});

test("Runpod completed error or failed job is not a valid transcript and never exposes provider details", async () => {
  for (const job of [
    { id: "job-1", status: "COMPLETED", output: { error: "private-worker-stack" } },
    { id: "job-1", status: "FAILED", error: "private-worker-stack" },
    { id: "job-1", status: "CANCELLED" }, { id: "job-1", status: "TIMED_OUT" },
  ]) {
    const f = fixture([job]);
    await assert.rejects(transcribeRunpodAudio(env, input, controller().signal, f.options), error => {
      assert.equal(error.status, 422);
      assert(!error.message.includes("private-worker-stack"));
      return true;
    });
    assert.equal(f.calls.length, 1, "An already terminal job does not need cancellation");
  }
});

test("Runpod rejects unsafe endpoint configuration and oversized input before making a request", async () => {
  for (const endpoint of [undefined, "", "https://other.example", "../other", "valid?token=secret"]) {
    const configured = { ...env, RUNPOD_TRANSCRIPTION_ENDPOINT: endpoint };
    assert.equal(runpodTranscriptionConfigured(configured), false);
    await assert.rejects(transcribeRunpodAudio(configured, input, controller().signal), error => error.status === 503);
  }
  assert.equal(runpodTranscriptionConfigured({ ...env, RUNPOD_API_KEY: " " }), false);
  const f = fixture([]);
  for (const invalid of [{ ...input, duration: 61 }, { ...input, audio: "" }, { ...input, audio: "a".repeat(3 * 1024 * 1024) }])
    await assert.rejects(transcribeRunpodAudio(env, invalid, controller().signal, f.options), error => error.status === 400);
  assert.equal(f.calls.length, 0);
});

test("Runpod abort cancels only its queued job and stops future status requests", async () => {
  const stopped = controller();
  const f = fixture([
    { id: "job-1", status: "IN_QUEUE" },
    options => {
      stopped.abort();
      assert.equal(options.signal.aborted, true);
      return Response.json({ id: "job-1", status: "IN_PROGRESS" });
    },
    { id: "job-1", status: "CANCELLED" },
  ]);
  await assert.rejects(transcribeRunpodAudio(env, input, stopped.signal, f.options), error => error.status === 400);
  assert.equal(f.calls.length, 3);
  assert.equal(new URL(f.calls[2].url).pathname, "/v2/verified-endpoint/cancel/job-1");
  assert.equal(f.calls[2].signal.aborted, false, "Cancellation uses a fresh, bounded signal");
});

test("Runpod deadline cancels a queued job even when a status fetch ignores abort", async () => {
  let release;
  const f = fixture([
    { id: "job-1", status: "IN_QUEUE" },
    () => new Promise(resolve => { release = resolve; }),
    { id: "job-1", status: "CANCELLED" },
  ]);
  await assert.rejects(transcribeRunpodAudio(env, input, controller().signal, { ...f.options, deadlineMs: 20 }), error => error.status === 504);
  assert.equal(f.calls.length, 3);
  assert(f.calls[1].signal.aborted);
  release(Response.json({ id: "job-1", status: "COMPLETED", output: transcript }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 3, "A late completion cannot start another poll or submit another job");
});

test("Runpod cancellation cannot hide the original failure or hang after its own deadline", async () => {
  const f = fixture([
    { id: "job-1", status: "IN_QUEUE" }, Response.json({ private: "details" }, { status: 503 }),
    () => new Promise(() => {}),
  ]);
  await assert.rejects(transcribeRunpodAudio(env, input, controller().signal, { ...f.options, cancelMs: 10 }), error => error.status === 503);
  assert.equal(f.calls.length, 3);
  assert(f.calls[2].signal.aborted);
});

test("Runpod malformed status, changed job ID and oversized result cancel pending work", async () => {
  for (const reply of [
    { id: "job-1", status: "UNKNOWN" }, { id: "different-job", status: "COMPLETED", output: transcript },
    new Response("not JSON", { headers: { "Content-Type": "application/json" } }),
    Response.json({ data: "a".repeat(256 * 1024) }),
  ]) {
    const f = fixture([{ id: "job-1", status: "IN_QUEUE" }, reply, { id: "job-1", status: "CANCELLED" }]);
    await assert.rejects(transcribeRunpodAudio(env, input, controller().signal, f.options), error => error.status === 422);
    assert.equal(f.calls.length, 3);
    assert.equal(new URL(f.calls[2].url).pathname, "/v2/verified-endpoint/cancel/job-1");
  }
});
