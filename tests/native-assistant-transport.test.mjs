import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: ["editor/src/infrastructure/assistant/nativeTransport.ts"],
  bundle: true, write: false, format: "esm", platform: "browser" });
const { requestNativeTurn } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const result = { message: "The project is ready.", operations: [], observations: [] };

test("native transport accepts strict JSON and keeps credentials on the same origin", async t => {
  let options;
  t.mock.method(globalThis, "fetch", async (url, input) => {
    assert.equal(url, "/api/assistant/turn"); options = input;
    return Response.json(result);
  });
  assert.deepEqual(await requestNativeTurn({}, new AbortController().signal), result);
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, undefined);
});

test("native transport bounds decoding and does not surface provider error bodies", async t => {
  let response = new Response("x".repeat(100000), { headers: { "Content-Type": "application/json" } });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => error.code === "model_output_invalid");
  response = new Response("private provider detail", { status: 503 });
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => error.status === 503 && !error.message.includes("private provider"));
  response = Response.json({ ...result, javascript: "bad()" });
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => error.code === "model_output_invalid");
});

test("native transport accepts only approved status/code pairs and bounds error decoding", async t => {
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  const check = async (value, status, expectedCode) => {
    response = Response.json(value, { status });
    await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => {
      assert.equal(error.status, status);
      assert.equal(error.code, expectedCode);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(response.body.locked, false);
  };
  await check({ code: "provider_allowance_exhausted", error: "private provider message" }, 429, "provider_allowance_exhausted");
  for (const code of ["model_output_invalid", "model_output_truncated", "edit_validation_failed"]) {
    await check({ code, error: "private rejected output", diagnostic: "private source" }, 422, code);
    await check({ code, error: "private rejected output" }, 503, undefined);
  }
  await check({ code: "untrusted_provider_code", error: "private provider message" }, 429, undefined);
  await check({ code: "provider_allowance_exhausted", error: "private provider message" }, 503, undefined);
  await check({ code: "provider_allowance_exhausted", error: "private".repeat(1000) }, 429, undefined);
  response = new Response("private malformed JSON", { status: 429, headers: { "Content-Type": "application/json" } });
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error =>
    error.status === 429 && error.code === undefined && !error.message.includes("private"));
});

test("Stop releases a stalled response reader and cannot return late output", async t => {
  let ready;
  let cancelled = false;
  const started = new Promise(resolve => { ready = resolve; });
  const response = new Response(new ReadableStream({
    start() { ready(); }, cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json" } });
  t.mock.method(globalThis, "fetch", async () => response);
  const controller = new AbortController();
  const task = requestNativeTurn({}, controller.signal);
  await started;
  await Promise.resolve();
  controller.abort();
  await assert.rejects(task, { name: "AbortError" });
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test("Stop releases a stalled provider-error response without replacing cancellation with a quota failure", async t => {
  let reading;
  let cancelled = false;
  const started = new Promise(resolve => { reading = resolve; });
  const response = new Response(new ReadableStream({
    pull() { reading(); }, cancel() { cancelled = true; },
  }), { status: 429, headers: { "Content-Type": "application/json" } });
  t.mock.method(globalThis, "fetch", async () => response);
  const controller = new AbortController();
  const task = requestNativeTurn({}, controller.signal);
  await started;
  await Promise.resolve();
  controller.abort();
  await assert.rejects(task, { name: "AbortError" });
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});


test("transport retains bounded server evidence and rejects oversized evidence", async t => {
  let response = { ...result, evidence: ['Sampled frame {"sceneTime":1}: A red cup.'] };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  assert.deepEqual(await requestNativeTurn({}, new AbortController().signal), response);
  response = { ...result, evidence: Array.from({ length: 5 }, () => "x".repeat(2000)) };
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => error.code === "model_output_invalid");
  response = { ...result, evidence: [" "] };
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => error.code === "model_output_invalid");
});

test("malformed successful JSON cannot expose an excerpt of model output", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("private unfinished JSON", {
    headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(requestNativeTurn({}, new AbortController().signal), error => {
    assert.equal(error.code, "model_output_invalid");
    assert.doesNotMatch(error.message, /private|unfinished JSON/);
    return true;
  });
});
