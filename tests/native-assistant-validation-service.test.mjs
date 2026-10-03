import test from "node:test";
import assert from "node:assert/strict";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { NativeAssistantError } from "../server/assistant/native/errors.js";
import { createNativeValidationTrace } from "../server/assistant/native/validationDiagnostics.js";
import { nativeDraft, nativeFixture, nativeInput } from "./native-assistant-server.helpers.mjs";

function recordedTurn(outputs, request = nativeInput()) {
  const events = [];
  const calls = [];
  const trace = createNativeValidationTrace({ write: event => events.push(event) });
  const task = nativeAssistantTurn(request, {
    signal: new AbortController().signal, trace,
    models: { textAttemptMs: 1000, generate: async input => {
      calls.push(input);
      const output = outputs[calls.length - 1];
      if (output instanceof Error) throw output;
      assert.notEqual(output, undefined, "The service must stay within its expected attempts");
      return output;
    } },
  });
  return { task, events, calls };
}

function assertPrivateDiagnostics(events) {
  assert(events.length > 0 && events.length <= 12);
  for (const event of events) {
    const serialized = JSON.stringify(event);
    assert(serialized.length < 2048);
    assert.doesNotMatch(serialized, /Private|987654321|secret|https?:|data:|Bearer|apiKey/);
  }
}

const transition = event => [event.stage, event.status, event.phase, event.attempt];
const invalidId = () => ({ message: "Private model wording", observations: [],
  operations: [{ kind: "clip.delete", sceneId: "main", clipId: 987654321 }] });
const terminal = () => ({ message: "The scene lasts ten seconds.", operations: [], observations: [] });

test("decode and canonical schema failures receive a traced repair without exposing private model text", async () => {
  const cases = [
    { content: '{"apiKey":"secret",', stage: "decode", rule: "json_syntax", path: null },
    { content: { message: "Private model text", operations: [{ kind: "text.add", text: "Private title", start: 1, end: 2 }], observations: [] },
      stage: "schema", rule: "required_field", path: "$.operations[].sceneId" },
  ];
  for (const fixture of cases) {
    const { task, calls, events } = recordedTurn([
      { content: fixture.content, finishReason: "stop" }, { content: nativeDraft(), finishReason: "stop" },
    ]);
    assert.deepEqual(await task, nativeDraft(), "The public result contains no trace diagnostics");
    assert.equal(calls.length, 2);
    assert.deepEqual(events.map(transition), [
      [fixture.stage, "failed", "initial", 1], ["repair", "started", "repair", 1], ["repair", "completed", "repair", 2],
    ]);
    assert.equal(events[0].classification, "model_output_invalid");
    assert.equal(events[0].rule, fixture.rule);
    assert.equal(events[0].schemaPath, fixture.path);
    assert.equal(events[0].finishReason, "stop");
    assertPrivateDiagnostics(events);
  }
});

test("an actual invalid editor operation repairs from the canonical policy error and leaves the request unchanged", async () => {
  const request = nativeInput();
  request.prompt = "Private creator request with https://secret.example";
  request.history = [{ role: "user", content: "Private earlier request" }];
  const original = structuredClone(request);
  const { task, events, calls } = recordedTurn([
    { content: invalidId(), finishReason: "stop" }, { content: nativeDraft(), finishReason: "end_turn" },
  ], request);
  assert.deepEqual(await task, nativeDraft());
  assert.deepEqual(request, original, "Rejected operations are never applied during repair");
  assert.match(calls[1].messages.at(-1).content, /Choose an existing clip ID from the supplied project/);
  assert.match(calls[1].messages.at(-1).content, /NONE of its operations or observations were executed/);
  assert.equal(events[0].stage, "policy");
  assert.equal(events[0].classification, "edit_validation_failed");
  assert.equal(events[0].rule, "clip_id_missing");
  assert.deepEqual(events[0].operationKinds, ["clip.delete"]);
  assert.equal(events.at(-1).finishReason, "end_turn");
  assertPrivateDiagnostics(events);
});

test("a failed completion review preserves its phase before the shared repair succeeds", async () => {
  const { task, events, calls } = recordedTurn([
    { content: terminal() }, { content: invalidId() }, { content: nativeDraft() },
  ]);
  assert.deepEqual(await task, nativeDraft());
  assert.equal(calls.length, 3);
  assert.deepEqual(events.map(transition), [
    ["review", "started", "review", 1], ["policy", "failed", "review", 2],
    ["repair", "started", "repair", 2], ["repair", "completed", "repair", 3],
  ]);
  assertPrivateDiagnostics(events);
});

test("a repaired terminal response completes its repair before its single completion review", async () => {
  const { task, events, calls } = recordedTurn([
    { content: invalidId() }, { content: terminal() }, { content: terminal() },
  ]);
  assert.deepEqual(await task, terminal());
  assert.equal(calls.length, 3);
  assert.deepEqual(events.map(transition), [
    ["policy", "failed", "initial", 1], ["repair", "started", "repair", 1],
    ["repair", "completed", "repair", 2], ["review", "started", "review", 2],
    ["review", "completed", "review", 3],
  ]);
  assertPrivateDiagnostics(events);
});

test("adapter generation failure is traced once and rethrown without model repair", async () => {
  const failure = new NativeAssistantError("model_output_truncated");
  failure.providerText = "Private response contains Bearer secret";
  const { task, events, calls } = recordedTurn([failure]);
  await assert.rejects(task, error => error === failure);
  assert.equal(calls.length, 1);
  assert.deepEqual(events.map(transition), [["decode", "failed", "initial", 1]]);
  assert.equal(events[0].classification, "model_output_truncated");
  assertPrivateDiagnostics(events);
});

test("exhausted policy repair returns only the fixed public error while retaining bounded diagnostics", async () => {
  const { task, events, calls } = recordedTurn([{ content: invalidId() }, { content: invalidId() }]);
  await assert.rejects(task, error => {
    assert.equal(error.status, 422);
    assert.equal(error.code, "edit_validation_failed");
    assert.doesNotMatch(error.message, /Private|987654321|clip\.delete|schemaPath|stage/);
    assert.deepEqual(Object.keys(error).sort(), ["code", "status"]);
    return true;
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(events.map(transition), [
    ["policy", "failed", "initial", 1], ["repair", "started", "repair", 1], ["policy", "failed", "repair", 2],
  ]);
  assertPrivateDiagnostics(events);
});

test("the assistant HTTP failure contract never includes server validation diagnostics or raw model fields", async t => {
  const invalid = { ...nativeDraft(), PrivateApiKey: "secret" };
  const fixture = await nativeFixture({ outputs: [{ response: invalid }, { response: invalid }] });
  t.after(fixture.close);
  const response = await fixture.turn();
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.deepEqual(body, {
    error: "The AI returned an invalid response. No changes were applied. Try again.",
    code: "model_output_invalid",
  });
  assert.equal(fixture.calls.length, 2);
});
