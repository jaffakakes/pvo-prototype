import assert from "node:assert/strict";
import test from "node:test";
import { runNativeModel, NATIVE_TEXT_MODEL } from "../server/assistant/native/cloudflare.js";
import { cloudflareTurn as nativeAssistantTurn } from "./native-assistant-server.helpers.mjs";
import { validateNativeResult } from "../server/assistant/native/policy.js";
import { nativeMessages } from "../server/assistant/native/prompt.js";
import { parseTranscriptionAudio, parseTranscriptionResult } from "../server/assistant/native/audio.js";
import { nativeDraft, nativeInput, wavAudio, frameObservation } from "./native-assistant-server.helpers.mjs";

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("model request order keeps the current task last and preserves supplied project and evidence", () => {
  const request = nativeInput();
  request.history = [{ role: "assistant", content: "Prepared a clip split; source audio timing is unchanged." }];
  request.project.scenes[0].components = [{ id: "actual-choice", type: "choice", at: 1, duration: 3,
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    x: 50, y: 60, label: "Choose", content: { prompt: "Choose" } }];
  const observations = [{ kind: "transcript", sceneId: "main", start: 0, end: 5, text: "The lantern turns green." }];
  const reordered = Object.fromEntries(Object.entries(request).reverse());
  const messages = nativeMessages(request, observations);
  const first = messages[1].content;
  const second = nativeMessages(reordered, observations)[1].content;
  assert.equal(first, second, "Incoming property order cannot change the model's data order");
  const data = JSON.parse(first);
  assert.deepEqual(Object.keys(data), ["history", "project", "observations", "mode", "prompt"]);
  assert.deepEqual(data, { ...request, observations });
  assert.equal(data.project.scenes[0].components[0].id, "actual-choice");
  assert.equal(messages.at(-1).role, "user");
  assert.ok(messages.at(-1).content.includes(JSON.stringify(request.prompt)));
  assert.match(messages.at(-1).content, /without inspecting footage unless a fact needed for THIS request is absent/);
});

test("native Stop aborts active inference and prevents late results or repairs", async () => {
  const controller = new AbortController();
  let release;
  let ready;
  let upstreamSignal;
  let count = 0;
  const started = new Promise(resolve => { ready = resolve; });
  const task = nativeAssistantTurn(nativeInput(), {
    ai: { run: (_model, _input, { signal }) => {
      count++; upstreamSignal = signal; ready();
      return new Promise(resolve => { release = resolve; });
    } },
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(task, error => error.status === 400);
  assert.equal(upstreamSignal.aborted, true);
  release({ response: nativeDraft() });
  await sleep(5);
  assert.equal(count, 1);
});

test("native total deadline aborts a stalled provider and prevents late repair work", async () => {
  let release;
  let calls = 0;
  let upstreamSignal;
  const task = nativeAssistantTurn(nativeInput(), {
    ai: { run: (_model, _input, { signal }) => {
      calls++;
      upstreamSignal = signal;
      return new Promise(resolve => { release = resolve; });
    } },
    signal: new AbortController().signal, totalMs: 10, attemptMs: 100,
  });
  await assert.rejects(task, error => error.status === 504);
  assert.equal(upstreamSignal.aborted, true);
  release({ response: "not JSON" });
  await sleep(5);
  assert.equal(calls, 1);
});

test("malformed PCM headers and inconsistent audio data are rejected", () => {
  assert.equal(parseTranscriptionAudio(wavAudio(60)).duration, 60);
  for (const mutation of [
    bytes => new DataView(bytes.buffer).setUint16(22, 2, true),
    bytes => new DataView(bytes.buffer).setUint32(24, 44100, true),
    bytes => new DataView(bytes.buffer).setUint32(40, 32002, true),
    bytes => new DataView(bytes.buffer).setUint32(4, 10, true),
  ]) {
    const bytes = wavAudio(); mutation(bytes);
    assert.throws(() => parseTranscriptionAudio(bytes), error => error.status === 400);
  }
  assert.deepEqual(parseTranscriptionResult({ text: "" }, 1), { text: "", segments: [] });
  assert.throws(() => parseTranscriptionResult({ text: "bad", segments: [{ text: "bad", start: 0.9, end: 0.2 }] }, 1));
});

test("native local development does not enable publishing or authentication origins", async () => {
  const { configuration } = await import("../server/config.js");
  const config = configuration({ PUBLIC_ORIGIN: "http://127.0.0.1:4174", ASSISTANT_LOCAL_DEVELOPMENT: "true",
    PUBLISHING_ENABLED: "true", DB: {}, MEDIA: {}, GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", SESSION_SECRET: "x".repeat(32) },
  "http://127.0.0.1:4174");
  assert.equal(config.origin, null);
  assert.equal(config.available, false);
});


test("native model envelopes reject code, malformed JSON and oversized provider output", async () => {
  for (const output of [
    { response: "not JSON" },
    { response: { ...nativeDraft(), javascript: "alert(1)" } },
    { response: { ...nativeDraft(), evidence: ["Invented frame evidence"] } },
    { response: nativeDraft(), tool_calls: [{ name: "fetch" }] },
    { response: { ...nativeDraft(), message: "x".repeat(65537) } },
  ]) {
    let calls = 0;
    await assert.rejects(nativeAssistantTurn(nativeInput(), {
      ai: { run: async () => { calls++; return output; } }, signal: new AbortController().signal,
    }), error => error.status === 422);
    assert.equal(calls, 2, "Only one schema repair is allowed");
  }
  const stringResult = await nativeAssistantTurn(nativeInput(), {
    ai: { run: async () => ({ response: JSON.stringify(nativeDraft()) }) }, signal: new AbortController().signal,
  });
  assert.deepEqual(stringResult, nativeDraft());
});

test("provider capacity errors retain their actionable status without private diagnostics", async () => {
  for (const [provider, status] of [
    [{ status: 429 }, 429], [{ internalCode: 3036 }, 429], [{ status: 500 }, 503],
  ]) {
    await assert.rejects(runNativeModel({ run: async () => { throw Object.assign(new Error("private prompt detail"), provider); } },
      NATIVE_TEXT_MODEL, {}, new AbortController().signal), error => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
  }
});


test("frame evidence survives a later transcript turn without repeating vision inference", async () => {
  const description = "A red cup is visible beside a blue plate.";
  let visionCalls = 0;
  let textCalls = 0;
  const dependencies = {
    signal: new AbortController().signal,
    ai: { run: async (model, input) => {
      if (model.includes("moondream")) {
        visionCalls++;
        return { result: { answer: description } };
      }
      textCalls++;
      assert.ok(input.response_format.json_schema.anyOf.every(branch => branch.properties.evidence === undefined), "The text model cannot author evidence");
      if (textCalls === 1) return { response: { message: "I need the spoken words too.", operations: [],
        observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 5 }] } };
      const request = JSON.parse(input.messages[1].content);
      assert.match(request.history[0].content, /red cup/);
      assert.match(request.history[0].content, /"sceneTime":1/);
      assert.match(request.history[0].content, /"sourceTime":4/);
      assert.equal(request.observations[0].text, "Pick up the cup.");
      assert.doesNotMatch(JSON.stringify(request), /data:image/);
      return { response: nativeDraft() };
    } },
  };
  const inspected = await nativeAssistantTurn({ ...nativeInput(), observations: [frameObservation()] }, dependencies);
  assert.equal(inspected.evidence.length, 1);
  assert.match(inspected.evidence[0], /interactive components excluded/);
  const edited = await nativeAssistantTurn({ ...nativeInput(),
    history: [{ role: "assistant", content: `Observed media evidence (data): ${inspected.evidence.join("\n")}` }],
    observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 5, text: "Pick up the cup." }],
  }, dependencies);
  assert.deepEqual(edited, nativeDraft());
  assert.equal(visionCalls, 1);
  assert.equal(textCalls, 2);
});

test("covered transcript ranges are repaired into operations without another media request", async () => {
  const transcript = { kind: "transcript", sceneId: "main", start: 0, end: 10,
    text: "The lantern turns green at dusk.", segments: [{ start: 0.11, end: 8.01, text: "The lantern turns green at dusk." }] };
  const input = { ...nativeInput(), observations: [transcript] };
  const calls = [];
  const result = await nativeAssistantTurn(input, {
    signal: new AbortController().signal,
    ai: { run: async (model, request) => {
      calls.push({ model, request });
      if (calls.length === 1) return { response: { message: "I'll check the speech again.", operations: [],
        observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 8.01 }] } };
      assert.match(request.messages.at(-1).content, /already supplied; use transcript evidence to proceed/);
      assert.deepEqual(JSON.parse(request.messages[1].content).observations, [transcript]);
      return { response: nativeDraft() };
    } },
  });
  assert.deepEqual(result, nativeDraft());
  assert.deepEqual(calls.map(call => call.model), [NATIVE_TEXT_MODEL, NATIVE_TEXT_MODEL]);
});

test("transcript coverage uses successful same-scene observations and does not restrict frames", async () => {
  const transcript = { kind: "transcript", sceneId: "main", start: 2, end: 8, text: "", segments: [] };
  const input = { ...nativeInput(), observations: [transcript, { ...frameObservation(), start: 0, end: 10 }] };
  input.project.scenes.push({ ...structuredClone(input.project.scenes[0]), id: "other" });
  const result = observation => ({ message: "Inspect the requested range.", operations: [], observations: [observation] });
  for (const [start, end] of [[2, 8], [2.1, 7.95], [3, 4]])
    await assert.rejects(validateNativeResult(input, result({ kind: "transcript", sceneId: "main", start, end })), /already supplied/);
  for (const observation of [
    { kind: "transcript", sceneId: "main", start: 0, end: 4 },
    { kind: "transcript", sceneId: "main", start: 6, end: 10 },
    { kind: "transcript", sceneId: "other", start: 2, end: 8 },
    { kind: "frames", sceneId: "main", start: 3, end: 4, count: 2 },
  ]) await validateNativeResult(input, result(observation));
  input.observations = [{ kind: "unavailable", sceneId: "main", requestedKind: "transcript", message: "No audio decoder available." }];
  await validateNativeResult(input, result({ kind: "transcript", sceneId: "main", start: 2, end: 8 }));
});

test("references to new objects explain that creation and dependent edits require separate turns", async () => {
  const input = nativeInput();
  const original = structuredClone(input);
  for (const [kind, creation, dependent] of [
    ["component", { kind: "component.add", sceneId: "main", componentType: "choice", at: 0, duration: 3 },
      { kind: "component.content", sceneId: "main", componentId: "2", changes: { prompt: "Choose" } }],
    ["clip", { kind: "clip.duplicate", sceneId: "main", clipId: 1 },
      { kind: "clip.update", sceneId: "main", clipId: 2, changes: { mirror: true } }],
    ["audio", { kind: "audio.extract", sceneId: "main", clipId: 1 },
      { kind: "audio.update", sceneId: "main", audioId: 2, changes: { gain: 0.5 } }],
    ["text", { kind: "text.add", sceneId: "main", text: "Hello", start: 0, end: 3 },
      { kind: "text.update", sceneId: "main", textId: 2, changes: { text: "World" } }],
  ]) {
    await assert.rejects(validateNativeResult(input, { message: "Prepare edits", observations: [], operations: [creation, dependent] }), error => {
      assert.match(error.message, new RegExp(`existing ${kind} ID`));
      assert.match(error.message, /none execute inside the reply/);
      assert.match(error.message, /ONLY the creation operations and independent operations/);
      assert.match(error.message, /next turn will supply their actual generated IDs/);
      return true;
    });
  }
  assert.deepEqual(input, original, "Invalid replies cannot apply even their valid creation operations");
});

test("creation repair keeps independent edits and waits for real IDs before dependent content", async () => {
  const create = { kind: "component.add", sceneId: "main", componentType: "choice", at: 0, duration: 3 };
  const independent = { kind: "text.add", sceneId: "main", text: "Welcome", start: 5, end: 7 };
  const dependent = { kind: "component.content", sceneId: "main", componentId: "2",
    changes: { prompt: "Choose a mood", optionLabels: ["Calm", "Energetic"] } };
  const invalid = { message: "Prepare a choice and title", observations: [], operations: [create, dependent, independent] };
  const repaired = { ...invalid, operations: [create, independent] };
  let calls = 0;
  const result = await nativeAssistantTurn(nativeInput(), {
    signal: new AbortController().signal,
    ai: { run: async (_model, request) => {
      if (++calls === 1) return { response: invalid };
      assert.match(request.messages.at(-1).content, /Remove follow-ups targeting newly created objects/);
      return { response: repaired };
    } },
  });
  assert.deepEqual(result, repaired);
  assert.equal(calls, 2);
  const next = nativeInput();
  next.project.scenes[0].components = [{ id: "actual-generated-id", type: "choice", at: 0, duration: 3,
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    x: 50, y: 50, label: "Choose", content: { prompt: "Choose" } }];
  const fill = { message: "Set the wording", observations: [], operations: [{ ...dependent, componentId: "actual-generated-id" }] };
  assert.deepEqual(await nativeAssistantTurn(next, {
    signal: new AbortController().signal,
    ai: { run: async () => ({ response: fill }) },
  }), fill);
});

test("server frame evidence shares a bounded text budget across every captured frame", async () => {
  const observation = frameObservation();
  observation.frames = Array.from({ length: 6 }, () => ({ ...observation.frames[0] }));
  const result = await nativeAssistantTurn({ ...nativeInput(), observations: [observation] }, {
    ai: { run: async model => model.includes("moondream")
      ? { result: { answer: "Visible details. ".repeat(250) } }
      : { response: nativeDraft() } }, signal: new AbortController().signal,
  });
  assert.equal(result.evidence.length, 6);
  assert.ok(result.evidence.every(item => item.length <= 2000 && item.endsWith("[truncated]")));
  assert.ok(result.evidence.reduce((total, item) => total + item.length, 0) <= 8000);
  assert.doesNotMatch(result.evidence.join(""), /data:image/);
});
