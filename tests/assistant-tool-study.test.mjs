import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { validateNativeResult } from "../server/assistant/native/policy.js";
import { nativeInput, frameObservation } from "./native-assistant-server.helpers.mjs";
import { COORDINATED_OBSERVATION_INSTRUCTION, expandStudyResult, studyImageHash, wrapStudyModels } from "../scripts/checks/editor/assistant-tool-study/variant-provider.mjs";
import { createRelayFetch, createStudyHandler } from "../scripts/checks/editor/assistant-tool-study/server.mjs";

const signal = () => new AbortController().signal;
const frame = { kind: "frames", sceneId: "main", start: 2, end: 4, count: 2 };
const transcript = { kind: "transcript", sceneId: "main", start: 0, end: 3 };
const result = observations => ({ message: "Inspecting the needed section.", operations: [], observations });
const combined = { kind: "inspect_media", sceneId: "main", transcript: { start: 0, end: 3 }, frames: { start: 2, end: 4, count: 2 } };

test("coordinated observations expand to the same independent canonical windows and order", () => {
  const source = result([combined]);
  const before = structuredClone(source);
  const expanded = expandStudyResult(source, "coordinated");
  assert.deepEqual(parseNativeTurnResult(expanded.content), result([transcript, frame]));
  assert.deepEqual(expanded.mappings, [{ logicalIndex: 0, logicalKind: "inspect_media", canonicalKinds: ["transcript", "frames"] }]);
  assert.deepEqual(source, before);
  assert.deepEqual(expandStudyResult(result([{ kind: "inspect_media", sceneId: "main", frames: combined.frames }]), "coordinated").content, result([frame]));
  assert.deepEqual(expandStudyResult(result([{ kind: "inspect_media", sceneId: "main", transcript: combined.transcript }]), "coordinated").content, result([transcript]));
  const reversed = { kind: "inspect_media", sceneId: "main", frames: combined.frames, transcript: combined.transcript };
  assert.deepEqual(expandStudyResult(result([reversed]), "coordinated").content, result([frame, transcript]));
});

test("both variants preserve existing separate observations including both modalities in one response", () => {
  for (const variant of ["separate", "coordinated"]) {
    const original = result([frame, transcript]);
    assert.deepEqual(expandStudyResult(original, variant).content, original);
  }
  assert.throws(() => parseNativeTurnResult(expandStudyResult(result([combined]), "separate").content));
});

test("coordinated syntax never grants extra modalities, fields or native observation budget", async () => {
  for (const invalid of [
    { kind: "inspect_media", sceneId: "main" },
    { ...combined, audio: {} },
    { ...combined, frames: { ...combined.frames, inventedEvidence: "found" } },
    { ...combined, transcript: null },
  ]) {
    const original = JSON.stringify(result([invalid]));
    const expanded = expandStudyResult(original, "coordinated");
    assert.equal(expanded.content, original);
    assert.ok(expanded.normalizationError);
    assert.throws(() => parseNativeTurnResult(JSON.parse(expanded.content)));
  }
  assert.throws(() => parseNativeTurnResult(expandStudyResult(result([combined, combined, combined]), "coordinated").content), /at most 4|4 items|too many/i);
  const tooManyFrames = result([{ ...combined, frames: { ...combined.frames, count: 7 } }]);
  assert.throws(() => parseNativeTurnResult(expandStudyResult(tooManyFrames, "coordinated").content));
  const outside = result([{ ...combined, transcript: { start: 0, end: 11 } }]);
  await assert.rejects(validateNativeResult(nativeInput(), parseNativeTurnResult(expandStudyResult(outside, "coordinated").content)));
});

test("the wrapper changes only B tool documentation and preserves model settings and evidence", async () => {
  const input = { messages: [{ role: "system", content: "Canonical instructions." }, { role: "user", content: "Evidence and request." }],
    schema: { anyOf: [] }, temperature: 0.15, maxTokens: 3000 };
  for (const variant of ["separate", "coordinated"]) {
    const records = [], calls = [];
    const models = wrapStudyModels({ textAttemptMs: 60000, frameAttemptMs: 60000,
      generate: async (forwarded, passedSignal) => { calls.push({ forwarded, passedSignal }); return { content: JSON.stringify(result([frame, transcript])) }; },
      describeFrame: async () => "Actual description",
    }, { variant, record: event => records.push(event) });
    const active = signal();
    await models.generate(input, active);
    assert.equal(calls[0].passedSignal, active);
    assert.equal(calls[0].forwarded.schema, input.schema);
    assert.equal(calls[0].forwarded.temperature, input.temperature);
    assert.equal(calls[0].forwarded.maxTokens, input.maxTokens);
    assert.deepEqual(calls[0].forwarded.messages.slice(1), input.messages.slice(1));
    assert.equal(calls[0].forwarded.messages[0].content, input.messages[0].content + (variant === "coordinated" ? COORDINATED_OBSERVATION_INSTRUCTION : ""));
    assert.equal(models.textAttemptMs, 60000);
    assert.equal(models.frameAttemptMs, 60000);
    assert.deepEqual(records[0].logicalObservations, [frame, transcript]);
    assert.deepEqual(records[0].canonicalObservations, [frame, transcript]);
    assert.equal(records[0].baselineInputHash === records[0].inputHash, variant === "separate");
  }
  assert.equal(input.messages[0].content, "Canonical instructions.");
});

test("invalid coordinated output uses the unchanged service repair lifecycle", async () => {
  const records = [], calls = [];
  const models = wrapStudyModels({ textAttemptMs: 60000, frameAttemptMs: 60000,
    generate: async input => {
      calls.push(input);
      return { content: result(calls.length === 1 ? [{ ...combined, unsupported: true }] : [combined]) };
    }, describeFrame: async () => "Unused",
  }, { variant: "coordinated", record: value => records.push(value) });
  const actual = await nativeAssistantTurn(nativeInput(), { models, signal: signal() });
  assert.deepEqual(actual, result([transcript, frame]));
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /NONE of its operations or observations were executed/);
  assert.equal(calls[1].messages[0].content.split(COORDINATED_OBSERVATION_INSTRUCTION).length, 2);
  assert.ok(records[0].normalizationError);
});

test("provider failures and cancellation propagate without experiment retries", async () => {
  const controller = new AbortController();
  controller.abort();
  let count = 0;
  const records = [];
  const models = wrapStudyModels({ generate: async (_input, active) => { count++; active.throwIfAborted(); } },
    { variant: "coordinated", record: event => records.push(event) });
  await assert.rejects(models.generate({ messages: [{ role: "system", content: "Prompt" }] }, controller.signal), { name: "AbortError" });
  assert.equal(count, 1);
  assert.equal(records[0].outcome, "cancelled");
});

const studyRequest = (stage, variant, request = nativeInput()) => new Request("http://127.0.0.1:5199/study/turn", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trialId: "case-r1-a", pairId: "case-r1", replicate: 1, variant, stage, request }),
});

test("frozen and live studies use the same native frame evidence transformation", async () => {
  const observation = frameObservation();
  const inputs = [];
  let liveVisionCalls = 0;
  const description = "A measured visible frame description.";
  const handler = createStudyHandler({ bank: { vision: [{ imageSha256: studyImageHash(observation.frames[0].dataUrl), description }],
    sharedInstruction: "\nShared finite observation menu." }, bankHash: "bank-hash",
    modelsForTrial: () => ({ textAttemptMs: 60000, frameAttemptMs: 60000,
      generate: async input => { inputs.push(input); return { content: result([transcript]) }; },
      describeFrame: async () => { liveVisionCalls++; return description; },
    }),
  });
  for (const stage of ["frozen", "live"]) for (const variant of ["separate", "coordinated"]) {
    const response = await handler(studyRequest(stage, variant, { ...nativeInput(), observations: [observation] }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.evidence.length, 1);
    assert.match(body.result.evidence[0], /measured visible frame/);
    assert.deepEqual(body.result.observations, [transcript]);
    assert.equal(body.telemetry.filter(event => event.kind === "vision").length, 1);
    const input = inputs.at(-1);
    assert.equal(input.messages[0].content.includes("Shared finite observation menu"), stage === "frozen");
    const evidence = JSON.parse(input.messages[1].content).observations;
    assert.equal(evidence[0].frames[0].description, description);
    assert.equal(evidence[0].frames[0].dataUrl, undefined);
  }
  assert.equal(liveVisionCalls, 2, "Frozen arms cannot consume new provider vision calls");
});

test("frozen vision misses fail without calling the live provider", async () => {
  let calls = 0;
  const handler = createStudyHandler({ bank: { vision: [] }, modelsForTrial: () => ({ frameAttemptMs: 60000,
    describeFrame: async () => { calls++; return "Invented fallback"; },
    generate: async () => { calls++; return { content: result([]) }; },
  }) });
  const response = await handler(studyRequest("frozen", "separate", { ...nativeInput(), observations: [frameObservation()] }));
  assert.equal(response.status, 422);
  assert.equal(calls, 0);
  assert.match((await response.json()).error, /exact frame/);
});

test("frozen study cannot accidentally call live transcription", async () => {
  let calls = 0;
  const handler = createStudyHandler({ modelsForTrial: () => ({}), transcribe: async () => { calls++; } });
  const response = await handler(new Request("http://127.0.0.1:5199/study/transcribe", {
    method: "POST", headers: { "Content-Type": "audio/wav", "X-Study-Stage": "frozen" }, body: new Uint8Array(44),
  }));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("study relay discards credential marker while retaining exact payload and cancellation", async () => {
  const calls = [], telemetry = [];
  const relay = createRelayFetch("http://127.0.0.1:5197/relay", { session: "test-session", transcriptionEndpoint: "endpoint",
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ accepted: true }); },
    record: event => telemetry.push(event),
  });
  const target = "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions";
  const body = JSON.stringify({ model: "kimi-k2.6", messages: [], temperature: 0.6, thinking: { type: "disabled" }, max_tokens: 3000 });
  const active = signal();
  await relay(target, { method: "POST", body, signal: active, headers: { Authorization: "Bearer local-marker", "Content-Type": "application/json" } });
  assert.equal(calls[0].url, "http://127.0.0.1:5197/relay");
  assert.equal(calls[0].options.body, body);
  assert.equal(calls[0].options.signal, active);
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers["X-Runpod-Target"], target);
  assert.equal(telemetry[0].model, "kimi-k2.6");
  assert.equal(telemetry[0].settings.temperature, 0.6);
  await assert.rejects(relay("https://other.example/v2/moonshot-kimi/openai/v1/chat/completions"));
  await assert.rejects(relay("https://api.runpod.ai/v2/unapproved/run"));
  assert.equal(calls.length, 1);
});
