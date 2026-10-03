import assert from "node:assert/strict";
import test from "node:test";
import { nativeModelConfiguration, nativeModels } from "../server/assistant/native/models.js";
import { nativeAssistantStatus } from "../server/assistant/native/provider.js";
import { runpodNativeModels, RUNPOD_NATIVE_MODEL } from "../server/assistant/native/runpod.js";
import { requestRunpodJson } from "../server/assistant/native/runpodHttp.js";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { nativeDraft, nativeInput, frameObservation, NATIVE_ORIGIN, nativeFixture } from "./native-assistant-server.helpers.mjs";

const signal = () => new AbortController().signal;
const completion = content => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
const generation = { messages: [{ role: "user", content: "Add a title." }], schema: { type: "object" }, maxTokens: 3000, temperature: 0.15 };

function transport(outputs) {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    calls.push({ url, ...options, payload: options.body === undefined ? undefined : JSON.parse(options.body) });
    const output = outputs[calls.length - 1];
    assert.notEqual(output, undefined, "No implicit model retry or fallback is allowed");
    if (output instanceof Error) throw output;
    return output instanceof Response ? output : Response.json(output);
  } };
}

test("Runpod selection requires its own server key and never falls back to a Cloudflare binding", () => {
  const ai = { run: () => assert.fail("Cloudflare must not be called") };
  const missing = { AI: ai, ASSISTANT_PROVIDER: "runpod" };
  assert.equal(nativeModelConfiguration(missing).available, false);
  assert.throws(() => nativeModels(missing), error => error.status === 503);
  assert.equal(nativeModelConfiguration({ AI: ai, ASSISTANT_PROVIDER: "typo" }).available, false);
  assert.throws(() => nativeModels({ AI: ai, ASSISTANT_PROVIDER: "typo" }), error => error.status === 503);
  const ready = { ...missing, RUNPOD_API_KEY: "server-test-key", PUBLIC_ORIGIN: NATIVE_ORIGIN,
    ASSISTANT_BUDGET: { getByName() {} } };
  const status = nativeAssistantStatus(ready, { origin: NATIVE_ORIGIN }, NATIVE_ORIGIN);
  assert.equal(status.available, true);
  assert.equal(status.model, RUNPOD_NATIVE_MODEL);
  assert.deepEqual(status.capabilities, { editing: true, frames: true, transcription: false, wordTiming: false, objectTracking: false });
  assert.doesNotMatch(JSON.stringify(status), /server-test-key|RUNPOD_API_KEY/);
});

test("Runpod text sends the native envelope schema through OpenAI format with server-only authorization", async () => {
  const http = transport([completion(JSON.stringify(nativeDraft()))]);
  const models = nativeModels({ ASSISTANT_PROVIDER: "runpod", RUNPOD_API_KEY: " server-test-key " }, http);
  const result = await models.generate(generation, signal());
  assert.deepEqual(JSON.parse(result.content), nativeDraft());
  const call = http.calls[0];
  assert.equal(call.url, "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions");
  assert.equal(call.headers.Authorization, "Bearer server-test-key");
  assert.equal(call.redirect, "manual");
  assert.deepEqual(call.payload, { model: "kimi-k2.6", stream: false,
    messages: generation.messages, thinking: { type: "disabled" }, temperature: 0.6, max_tokens: 3000,
    response_format: { type: "json_schema", json_schema: { name: "native_editor_turn", strict: false, schema: generation.schema } },
  });
  assert.doesNotMatch(call.body, /server-test-key/);
});

test("Runpod sees actual sampled images, then the native planner receives only the resulting evidence", async () => {
  const frame = frameObservation();
  const http = transport([completion("A blue cup is visible."), completion(JSON.stringify(nativeDraft()))]);
  const result = await nativeAssistantTurn({ ...nativeInput(), observations: [frame] }, {
    models: runpodNativeModels("server-test-key", http), signal: signal(),
  });
  assert.deepEqual(result.operations, nativeDraft().operations);
  assert.match(result.evidence[0], /blue cup/);
  const imageRequest = http.calls[0].payload;
  assert.equal(imageRequest.model, "kimi-k2.6");
  assert.deepEqual(imageRequest.thinking, { type: "disabled" });
  assert.equal(imageRequest.temperature, 0.6);
  assert.deepEqual(imageRequest.messages[0].content[1], { type: "image_url", image_url: { url: frame.frames[0].dataUrl } });
  assert.match(imageRequest.messages[0].content[0].text, /timeline 1s, source 4s/);
  assert.doesNotMatch(JSON.stringify(http.calls[1].payload), /data:image/);
  const context = JSON.parse(http.calls[1].payload.messages[1].content);
  assert.equal(context.observations[0].frames[0].description, "A blue cup is visible.");
});

test("native validation repairs malformed Runpod JSON using the same request and typed action boundaries", async () => {
  const http = transport([completion("not JSON"), completion(JSON.stringify(nativeDraft()))]);
  const result = await nativeAssistantTurn(nativeInput(), { models: runpodNativeModels("server-test-key", http), signal: signal() });
  assert.deepEqual(result, nativeDraft());
  assert.equal(http.calls.length, 2);
  assert.match(http.calls[1].payload.messages.at(-1).content, /Validation rejected/);
  assert.ok(http.calls[1].payload.messages.at(-1).content.includes(JSON.stringify(nativeInput().prompt)));
});

test("Runpod failures and malformed envelopes never expose private bodies or switch providers", async () => {
  for (const [output, status, code] of [
    [new Response("private provider reason", { status: 429 }), 429],
    [new Response("private credential detail", { status: 401 }), 503],
    [new Error("private network address"), 503],
    [new Response("private HTML response", { headers: { "Content-Type": "text/html" } }), 422],
    [{ choices: [] }, 422],
    [{ choices: [null] }, 422],
    [{ choices: [{ finish_reason: "length", message: { role: "assistant", content: "private partial" } }] }, 422, "model_output_truncated"],
    [{ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "text", tool_calls: [{ id: "private-tool" }] } }] }, 422],
    [{ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "text", refusal: "private-refusal" } }] }, 422],
  ]) {
    const http = transport([output]);
    await assert.rejects(runpodNativeModels("server-test-key", http).generate(generation, signal()), error => {
      assert.equal(error.status, status);
      assert.equal(error.code, code ?? (status === 422 ? "model_output_invalid" : undefined));
      assert.doesNotMatch(error.message, /private|server-test-key/);
      return true;
    });
    assert.equal(http.calls.length, 1);
  }
});

test("Runpod response reads are bounded and cancelled without retaining overlarge data", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(128 * 1024 + 1));
  }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
  const http = transport([response]);
  await assert.rejects(runpodNativeModels("server-test-key", http).generate(generation, signal()), error => error.status === 422);
  assert.equal(cancelled, true);
});

test("Stop cancels a stalled Runpod body and prevents a late model result", async () => {
  const controller = new AbortController();
  let cancelled = false;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const http = { fetch: async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    started();
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
  } };
  const task = runpodNativeModels("server-test-key", http).generate(generation, controller.signal);
  await ready;
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(task, error => error.name === "AbortError");
  assert.equal(cancelled, true);
});

test("the shared Runpod transport rejects non-provider paths before sending credentials", async () => {
  const fetch = () => assert.fail("An invalid path must never receive credentials");
  for (const path of ["https://other.test/v2/model/run", "//other.test/v2/model/run", "/v2/model/../run", "/v2/model/run?token=x"])
    await assert.rejects(requestRunpodJson(path, {}, "server-test-key", signal(), { fetch }), error => error.status === 503);
});


test("native HTTP routes select Runpod text and configured audio without using Cloudflare", async t => {
  const fixture = await nativeFixture({ provider: "runpod", runpodKey: "server-test-key", transcriptionEndpoint: "verified-audio", outputs: [
    completion(JSON.stringify(nativeDraft())),
    { id: "verified-job", status: "COMPLETED", output: { segments: [{ start: 0, end: 0.7, text: "Hello." }] } },
  ] });
  t.after(fixture.close);
  const status = await (await fixture.fetch("status")).json();
  assert.deepEqual(status.capabilities, { editing: true, frames: true, transcription: true, wordTiming: false, objectTracking: false });
  const turn = await fixture.turn();
  assert.deepEqual(await turn.json(), nativeDraft());
  const audio = await fixture.transcribe();
  assert.deepEqual(await audio.json(), { text: "Hello.", segments: [{ start: 0, end: 0.7, text: "Hello." }] });
  assert.equal(new URL(fixture.calls[0].url).pathname, "/v2/moonshot-kimi/openai/v1/chat/completions");
  assert.equal(new URL(fixture.calls[1].url).pathname, "/v2/verified-audio/run");
  assert.match(fixture.calls[1].input.input.audio_file, /^data:audio\/wav;base64,/);
  assert.equal(fixture.calls.length, 2);
});
