import assert from "node:assert/strict";
import test from "node:test";
import { nativeDraft, nativeFixture, nativeInput, frameObservation, wavAudio } from "./native-assistant-server.helpers.mjs";

test("native operations are model-generated, strict and anonymous without quota infrastructure", async t => {
  const fixture = await nativeFixture();
  t.after(fixture.close);
  const response = await fixture.turn();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), nativeDraft());
  assert.equal(fixture.calls[0].model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(fixture.calls[0].input.response_format.type, "json_schema");
  assert.deepEqual(JSON.parse(fixture.calls[0].input.messages[1].content), nativeInput());
});

test("a reviewed blocker preserves no-commit metadata across the HTTP boundary", async t => {
  const blocked = { message: "What is the approved headline?", operations: [], observations: [], blocked: true };
  const fixture = await nativeFixture({ outputs: [{ response: blocked }, { response: blocked }] });
  t.after(fixture.close);
  const response = await fixture.turn({ ...nativeInput(), prompt: "Add the approved headline." });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), blocked);
  assert.equal(fixture.calls.length, 2);
});

test("a completed edit's requested substantive answer survives HTTP completion review", async t => {
  const final = { message: "The title is ready.", operations: [], observations: [], answer: "The speaker says: Hello everyone." };
  const fixture = await nativeFixture({ outputs: [{ response: final }, { response: final }] });
  t.after(fixture.close);
  const input = { ...nativeInput(), prompt: "Add the title Hello and tell me the spoken words.",
    history: [{ role: "assistant", content: "The editor prepared the title with ID 42." }],
    observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 5, text: "Hello everyone." }],
  };
  input.project.scenes[0].texts = [{ id: 42, text: "Hello", start: 2, end: 5, x: 50, y: 50 }];
  const response = await fixture.turn(input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), final);
  assert.equal(fixture.calls.length, 2);
});

test("status reports hosted ChatGPT unavailable honestly without requiring login", async t => {
  const fixture = await nativeFixture({ available: false });
  t.after(fixture.close);
  const response = await fixture.fetch("status");
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.available, false);
  assert.equal(status.capabilities.frames, false);
  assert.equal(status.chatgpt.available, false);
  assert.equal(status.chatgpt.reason, "hosted_access_required");
  assert.equal((await fixture.turn()).status, 503);
  assert.equal((await fixture.fetch("../assistant", { method: "POST" })).status, 404);
});

test("origin, unknown fields, context and observation bounds reject before model capacity", async t => {
  const fixture = await nativeFixture();
  t.after(fixture.close);
  assert.equal((await fixture.turn(nativeInput(), { headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await fixture.turn({ ...nativeInput(), token: "secret" })).status, 400);
  const outside = { ...frameObservation(), end: 12 };
  assert.equal((await fixture.turn({ ...nativeInput(), observations: [outside] })).status, 400);
  const mistimed = frameObservation();
  mistimed.frames[0].sourceTime = 1;
  assert.equal((await fixture.turn({ ...nativeInput(), observations: [mistimed] })).status, 400);
  const many = frameObservation();
  many.frames = Array.from({ length: 6 }, () => many.frames[0]);
  assert.equal((await fixture.turn({ ...nativeInput(), observations: [many, frameObservation()] })).status, 413);
  assert.equal((await fixture.turn({ ...nativeInput(), prompt: "x".repeat(3 * 1024 * 1024) })).status, 413);
  assert.equal(fixture.calls.length, 0);
});

test("Ask-mode mutation and mixed inspect/edit outputs receive one bounded repair", async t => {
  const final = { message: "The scene is ten seconds long.", operations: [], observations: [] };
  const fixture = await nativeFixture({ outputs: [{ response: nativeDraft() }, { response: final }, { response: final }] });
  t.after(fixture.close);
  const response = await fixture.turn({ ...nativeInput(), mode: "ask" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), final);
  assert.match(fixture.calls[1].input.messages.at(-1).content, /Ask mode/);
  assert.equal(fixture.calls.length, 3, "The repaired answer receives its one completion review");
  const mixed = { ...nativeDraft(), observations: [{ kind: "frames", sceneId: "main", start: 0, end: 5, count: 2 }] };
  const rejected = await nativeFixture({ outputs: [{ response: mixed }, { response: mixed }] });
  t.after(rejected.close);
  assert.equal((await rejected.turn()).status, 422);
  assert.equal(rejected.calls.length, 2);
});

test("invalid IDs cannot reach the browser after the single permitted repair", async t => {
  const invalid = { ...nativeDraft(), operations: [{ kind: "clip.delete", sceneId: "main", clipId: 999 }] };
  const fixture = await nativeFixture({ outputs: [{ response: invalid }, { response: invalid }] });
  t.after(fixture.close);
  assert.equal((await fixture.turn()).status, 422);
  assert.equal(fixture.calls.length, 2);
});

test("timestamped frames go to vision and only actual descriptions enter text inference", async t => {
  const final = { message: "At 1 second, a red cup is visible.", operations: [], observations: [] };
  const fixture = await nativeFixture({ outputs: [{ result: { answer: "A red cup is on a table." } }, { response: final }, { response: final }] });
  t.after(fixture.close);
  const input = { ...nativeInput(), mode: "ask", observations: [frameObservation()] };
  const response = await fixture.turn(input);
  assert.equal(response.status, 200);
  assert.equal(fixture.calls[0].model, "@cf/moondream/moondream3.1-9B-A2B");
  assert.equal(fixture.calls[0].input.image, input.observations[0].frames[0].dataUrl);
  const passed = JSON.parse(fixture.calls[1].input.messages[1].content).observations[0].frames[0];
  assert.equal(passed.description, "A red cup is on a table.");
  assert.equal(passed.sceneTime, 1);
  assert.equal(passed.sourceTime, 4);
  assert.equal(passed.dataUrl, undefined);
  assert.equal(fixture.calls.length, 3, "The completion review reuses existing visual descriptions");
});

test("WAV route validates bytes and duration before inference and returns only real timestamps", async t => {
  const fixture = await nativeFixture({ outputs: [{ text: "Hello", segments: [{ start: 0.2, end: 0.8, text: "Hello", no_speech_prob: 0.01 }] }] });
  t.after(fixture.close);
  assert.equal((await fixture.transcribe(new Uint8Array(44))).status, 400);
  assert.equal((await fixture.transcribe(wavAudio(), { headers: { "X-Audio-Duration": "61" } })).status, 400);
  assert.equal((await fixture.transcribe(wavAudio(61))).status, 413);
  assert.equal(fixture.calls.length, 0);
  const response = await fixture.transcribe();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "Hello", segments: [{ start: 0.2, end: 0.8, text: "Hello" }] });
  assert.equal(fixture.calls[0].model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(Buffer.from(fixture.calls[0].input.audio, "base64").byteLength, wavAudio().byteLength);
  const missingTimings = await nativeFixture({ outputs: [{ text: "Hello" }] });
  t.after(missingTimings.close);
  assert.deepEqual(await (await missingTimings.transcribe()).json(), { text: "Hello", segments: [] });
});

test("private upstream failures and invalid transcript timings do not leak into results", async t => {
  const fixture = await nativeFixture({ outputs: [new Response("private model failure", { status: 500 })] });
  t.after(fixture.close);
  const response = await fixture.turn();
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("private model"));
  const timestamps = await nativeFixture({ outputs: [{ text: "Hello", segments: [{ start: 0, end: 90, text: "Hello" }] }] });
  t.after(timestamps.close);
  assert.equal((await timestamps.transcribe()).status, 422);
});

test("native component sources compile and never grant new network effects", async t => {
  const source = {
    structure: '<card><title>Join</title><button id="next">Continue</button></card>', style: '',
    logic: 'on press(next) { request({"url":"https://example.com","method":"POST","body":"{}","onSuccess":{"kind":"continue"},"onError":null}); }',
  };
  const draft = { message: "Add a contact card", observations: [], operations: [
    { kind: "component.add", sceneId: "main", componentType: "card", at: 0, duration: 5, source },
  ] };
  const denied = await nativeFixture({ outputs: [{ response: draft }, { response: draft }] });
  t.after(denied.close);
  assert.equal((await denied.turn()).status, 422);
  assert.equal(denied.calls.length, 2);
  assert.match(denied.calls[1].input.messages.at(-1).content, /network requests/);
  const valid = { ...draft, operations: [{ ...draft.operations[0], source: { ...source, logic: 'on press(next) { continue(); }' } }] };
  const allowed = await nativeFixture({ outputs: [{ response: valid }] });
  t.after(allowed.close);
  assert.equal((await allowed.turn()).status, 200);
});

test("style-only operations compile safe design without exposing or replacing request Logic", async t => {
  const input = nativeInput();
  input.project.scenes[0].components = [{ id: "contact", type: "card", at: 0, duration: 5, x: 50, y: 50,
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    label: "Contact", content: { title: "Contact" }, design: {
      structure: '<card><title>Contact</title><button id="send">Send</button></card>', style: '',
      logic: 'on press(send) { continue(); }',
    } }];
  const result = { message: "Make the card green.", observations: [], operations: [
    { kind: "component.style", sceneId: "main", componentId: "contact", style: 'card { background: #00ff00; }' },
  ] };
  const fixture = await nativeFixture({ outputs: [{ response: result }] });
  t.after(fixture.close);
  assert.equal((await fixture.turn(input)).status, 200);
  const invalid = { ...result, operations: [{ ...result.operations[0], style: 'body { background: url(https://outside.example); }' }] };
  const rejected = await nativeFixture({ outputs: [{ response: invalid }, { response: invalid }] });
  t.after(rejected.close);
  assert.equal((await rejected.turn(input)).status, 422);
});

test("HTTP development inference requires opt-in, exact loopback origin and same-origin requests", async t => {
  for (const origin of ["http://127.0.0.1:8796", "http://localhost:8796", "http://[::1]:8796"]) {
    const fixture = await nativeFixture({ origin, localDevelopment: true });
    t.after(fixture.close);
    assert.equal((await fixture.fetch("status")).status, 200);
    assert.equal((await fixture.turn(nativeInput(), { headers: { Origin: "http://localhost:4174" } })).status, 403);
    assert.equal((await fixture.turn(nativeInput(), { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await fixture.turn()).status, 200);
  }
  for (const options of [{ origin: "http://127.0.0.1:8796" },
    { origin: "http://outside.example", localDevelopment: true }]) {
    const fixture = await nativeFixture(options);
    t.after(fixture.close);
    assert.equal((await fixture.turn()).status, 503);
    assert.equal((await (await fixture.fetch("status")).json()).available, false);
  }
});


test("anonymous inference continues beyond sixty calls without an app usage cap", async t => {
  const fixture = await nativeFixture({ outputs: Array.from({ length: 65 }, () => ({ response: nativeDraft() })) });
  t.after(fixture.close);
  const status = await (await fixture.fetch("status")).json();
  assert.equal(status.available, true, "Only the AI binding and valid origin are required");
  assert.deepEqual(status.capabilities, { editing: true, frames: true, transcription: true, wordTiming: false, objectTracking: false });
  const responses = await Promise.all(Array.from({ length: 65 }, async () => {
    const response = await fixture.turn();
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.equal(fixture.calls.length, 65);
  for (const response of responses) assert.deepEqual(response, nativeDraft());
});
