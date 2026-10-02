import assert from "node:assert/strict";
import test from "node:test";
import { normalizedAlignmentWords, parseNativeTurnResult, parseNativeTurnRequest, parseWordAlignment } from "../packages/pvo-assistant/native/index.js";
import { alignmentConfigured, alignNativeAudio, parseAlignmentInput } from "../server/assistant/native/alignment.js";
import { validateNativeInput, validateNativeResult } from "../server/assistant/native/policy.js";
import { nativeFixture, nativeInput, wavAudio } from "./native-assistant-server.helpers.mjs";

const provenance = { method: "forced_alignment", engine: "mfa", version: "3.4.2+pvo.1",
  acousticModel: "english_mfa", dictionary: "english_mfa", language: "en",
  transcriptVerified: false, refined: true };
const input = () => ({ audio: Buffer.from(wavAudio()).toString("base64"), duration: 1,
  text: "I don’t want peace.", language: "en" });
const result = () => ({ text: "I don't want peace", words: [
  { text: "i", start: 0.1, end: 0.2 }, { text: "don't", start: 0.2, end: 0.42 },
  { text: "want", start: 0.42, end: 0.64 }, { text: "peace", start: 0.64, end: 0.91 },
], provenance });
const env = { ASSISTANT_LOCAL_DEVELOPMENT: "true", MFA_ALIGNMENT_URL: "http://127.0.0.1:5198/align",
  MFA_ALIGNMENT_TOKEN: "local-test-token-with-at-least-32-characters" };

test("alignment request validates actual WAV and a bounded complete English transcript", () => {
  assert.equal(parseAlignmentInput(input()).duration, 1);
  for (const patch of [{ duration: 2 }, { language: "fr" }, { text: "" }, { text: "word ".repeat(301) },
    { audio: "!!!!" }, { model: "/arbitrary/path" }])
    assert.throws(() => parseAlignmentInput({ ...input(), ...patch }));
  assert.deepEqual(normalizedAlignmentWords("“I DON’T want peace.”"), ["i", "don't", "want", "peace"]);
});

test("word alignment preserves truthful provenance and rejects incomplete/mismatched/overlapping timings", () => {
  assert.equal(parseWordAlignment(result(), input()).words[2].end, 0.64);
  for (const mutate of [
    value => value.words.pop(),
    value => { value.words[2].text = "need"; },
    value => { value.words[3].start = 0.6; },
    value => { value.words[3].end = 1.1; },
    value => { value.words[3].start = 1.0000001; value.words[3].end = 1.0000002; },
    value => { value.words[3].start = 1; value.words[3].end = 1.0000002; },
    value => { value.words[0].start = -0.01; },
    value => { value.provenance.transcriptVerified = true; },
    value => { value.text = "An invented sentence"; },
  ]) {
    const value = structuredClone(result()); mutate(value);
    assert.throws(() => parseWordAlignment(value, input()));
  }
});

test("local timing adapter restricts destination and does not follow redirects or leak credentials", async () => {
  assert.equal(alignmentConfigured(env), true);
  for (const patch of [{ ASSISTANT_LOCAL_DEVELOPMENT: "false" }, { MFA_ALIGNMENT_TOKEN: "" },
    { MFA_ALIGNMENT_URL: "https://example.com/align" }, { MFA_ALIGNMENT_URL: "http://127.0.0.1:5198/align?x=1" }])
    assert.equal(alignmentConfigured({ ...env, ...patch }), false);
  const actual = await alignNativeAudio(env, input(), undefined, { fetch: async (url, options) => {
    assert.equal(url, env.MFA_ALIGNMENT_URL);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, `Bearer ${env.MFA_ALIGNMENT_TOKEN}`);
    return Response.json(result());
  } });
  assert.equal(actual.provenance.transcriptVerified, false);
  for (const status of [302, 429, 500, 503, 504])
    await assert.rejects(alignNativeAudio(env, input(), undefined, {
      fetch: async () => new Response("private diagnostic", { status }),
    }), error => error.status === ([429, 503, 504].includes(status) ? status : 422) && !error.message.includes("private"));
});

test("timing deadline aborts a stalled upstream", async () => {
  let observed;
  await assert.rejects(alignNativeAudio(env, input(), undefined, { deadlineMs: 10, fetch: (_url, options) => {
    observed = options.signal;
    return new Promise(() => {});
  } }), error => error.status === 504);
  assert.equal(observed.aborted, true);
});

test("word timing schema and server verify source mapping after trim and speed", async () => {
  const request = nativeInput();
  const timing = { kind: "word_timing", sceneId: "main", start: 0, end: 0.5,
    source: { kind: "clip", id: 1 }, text: input().text, language: "en" };
  const turn = parseNativeTurnResult({ message: "Locate the words.", operations: [], observations: [timing] });
  await validateNativeResult(request, turn);
  const observation = { kind: "word_timing", sceneId: "main", start: 0, end: 0.5,
    source: timing.source, sourceStart: 2, sourceEnd: 3, text: timing.text, provenance,
    words: result().words.map(word => ({ text: word.text, start: word.start / 2, end: word.end / 2,
      sourceStart: 2 + word.start, sourceEnd: 2 + word.end })) };
  request.observations = [observation];
  validateNativeInput(parseNativeTurnRequest(request));
  request.observations[0].words[0].start += 0.02;
  assert.throws(() => validateNativeInput(request), /do not agree/);
  await assert.rejects(validateNativeResult(nativeInput(), { ...turn, observations: [{ ...timing,
    source: { kind: "clip", id: 999 } }] }), /existing source/);
});

test("alignment HTTP route requires local configuration, same origin and a valid payload", async () => {
  const fixture = await nativeFixture({ alignment: true, localDevelopment: true, outputs: [result()] });
  const options = () => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input()) });
  try {
    assert.equal((await fixture.fetch("status")).status, 200);
    const rejected = await fixture.fetch("align", {
      method: "POST", headers: { Origin: "https://foreign.example" },
    });
    assert.equal(rejected.status, 403);
    assert.equal(fixture.calls.length, 0);
    const response = await fixture.fetch("align", options());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).words[2].end, 0.64);
    assert.equal(fixture.calls.length, 1);
  } finally { await fixture.close(); }
  const hosted = await nativeFixture({ alignment: true });
  try { assert.equal((await hosted.fetch("align", options())).status, 503); }
  finally { await hosted.close(); }
});

test("planning offers local word timing only to clients that explicitly support it", async () => {
  const answer = { message: "This scene lasts ten seconds.", operations: [], observations: [] };
  for (const supported of [false, true]) {
    const fixture = await nativeFixture({ alignment: true, localDevelopment: true,
      outputs: [{ response: answer }, { response: answer }] });
    try {
      const status = await (await fixture.fetch("status")).json();
      assert.equal(status.capabilities.wordTiming, true);
      const request = nativeInput(); request.mode = "ask"; request.prompt = "How long is the scene?";
      const response = await fixture.turn(request, { headers: supported ? { "X-Assistant-Word-Timing": "1" } : {} });
      assert.equal(response.status, 200);
      assert.equal(fixture.calls[0].input.messages[0].content.includes("Word timing is available for English speech"), supported);
    } finally { await fixture.close(); }
  }
});
