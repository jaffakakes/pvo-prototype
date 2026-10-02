import assert from "node:assert/strict";
import test from "node:test";
import { objectTrackingTimes, parseObjectTrackingResult } from "../packages/pvo-assistant/native/index.js";
import { parseTrackingInput } from "../server/assistant/native/trackingInput.js";
import { trackingConfigured, trackNativeObject } from "../server/assistant/native/tracking.js";
import { readTrackingJson } from "../server/assistant/native/trackingBody.js";
import { nativeFixture, nativeInput } from "./native-assistant-server.helpers.mjs";
import { trackingInput, trackingOutput } from "./native-tracking.helpers.mjs";

const env = { SAM_TRACKING_URL: "https://testpod-8000.proxy.runpod.net/track", SAM_TRACKING_TOKEN: "private-test-token-with-at-least-32-characters" };
const expected = () => ({ width: 16, height: 16, times: objectTrackingTimes(0, .2) });

test("tracking sampling covers both endpoints and limits one request to ten seconds", () => {
  assert.equal(objectTrackingTimes(2, 12).length, 151);
  assert.deepEqual(objectTrackingTimes(0, .1), [0, 1 / 15, .1]);
  for (const pair of [[0, 10.01], [-1, 1], [2, 2], [NaN, 1], [0, Infinity]])
    assert.throws(() => objectTrackingTimes(...pair));
});

test("tracking input checks real JPEG dimensions, canonical sampling and exact bounded payload", () => {
  assert.deepEqual(parseTrackingInput(trackingInput()), trackingInput());
  for (const change of [
    value => { value.width = 640; }, value => { value.height = 641; },
    value => { value.frames[0].imageDataUrl = "https://private.example/frame"; },
    value => { value.frames[0].imageDataUrl = "data:image/jpeg;base64," + "a".repeat(160 * 1024); },
    value => { value.frames[0].time += .01; }, value => { value.frames.pop(); },
    value => { value.target = { kind: "point", x: 2, y: .5 }; },
    value => { value.target = { kind: "text", text: "" }; },
    value => { value.url = "https://arbitrary.example"; }, value => { value.clipId = -1; },
  ]) {
    const value = trackingInput(); change(value);
    assert.throws(() => parseTrackingInput(value));
  }
});

test("tracking responses require exact times/dimensions and center boxes; invisibility never invents measurements", () => {
  const result = trackingOutput();
  result.frames[1] = { time: 1 / 15, visible: false, x: 0, y: 0, width: 0, height: 0, score: 0 };
  assert.deepEqual(parseObjectTrackingResult(result, expected()), result);
  for (const change of [
    value => { value.model = "sam2"; }, value => { value.width = 100; }, value => { value.frames.pop(); },
    value => { value.frames[0].time += .01; }, value => { value.frames[0].score = NaN; },
    value => { value.frames[0].visible = false; }, value => { value.frames[0].x = .01; },
    value => { value.frames[0].height = 0; }, value => { value.frames[0].privatePath = "/tmp/model"; },
  ]) {
    const value = trackingOutput(); change(value);
    assert.throws(() => parseObjectTrackingResult(value, expected()));
  }
});

test("tracking configuration restricts credentials to exact Runpod proxy route or explicit local development", async () => {
  assert.equal(trackingConfigured(env), true);
  for (const url of ["https://example.com/track", "https://testpod-8000.proxy.runpod.net/other", "http://testpod-8000.proxy.runpod.net/track",
    "https://testpod-8000.proxy.runpod.net/track?x=1", "https://user:password@testpod-8000.proxy.runpod.net/track", "http://127.0.0.1:5199/track"])
    assert.equal(trackingConfigured({ ...env, SAM_TRACKING_URL: url }), false);
  assert.equal(trackingConfigured({ ...env, SAM_TRACKING_URL: "http://127.0.0.1:5199/track", ASSISTANT_LOCAL_DEVELOPMENT: "true" }), true);
  assert.equal(trackingConfigured({ ...env, SAM_TRACKING_TOKEN: "short" }), false);
  const result = await trackNativeObject(env, trackingInput(), undefined, { fetch: async (url, options) => {
    assert.equal(url, env.SAM_TRACKING_URL);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, `Bearer ${env.SAM_TRACKING_TOKEN}`);
    assert.deepEqual(JSON.parse(options.body), trackingInput());
    return Response.json(trackingOutput());
  } });
  assert.equal(result.frames.length, 4);
});

test("tracking fails closed on redirects/errors and translates only known target failures", async () => {
  for (const status of [302, 409, 429, 500, 503, 504]) {
    let calls = 0;
    await assert.rejects(trackNativeObject(env, trackingInput(), undefined, { fetch: async () => {
      calls++; return new Response("private diagnostic", { status });
    } }), error => error.status === (status === 409 ? 429 : [429, 503, 504].includes(status) ? status : 422) && !error.message.includes("private"));
    assert.equal(calls, 1);
  }
  await assert.rejects(trackNativeObject(env, trackingInput(), undefined, {
    fetch: async () => Response.json({ code: "ambiguous_target", private: "secret" }, { status: 422 }),
  }), /More than one object matches/);
  await assert.rejects(trackNativeObject(env, trackingInput(), undefined, {
    fetch: async () => Response.json({ code: "target_not_found" }, { status: 422 }),
  }), /No matching object/);
  await assert.rejects(trackNativeObject(env, trackingInput(), undefined, {
    fetch: async () => Response.json({ ...trackingOutput(), frames: [] }),
  }), error => error.status === 422);
});

test("tracking cancels stalled fetches and response readers on deadline or parent abort", async () => {
  let upstream;
  await assert.rejects(trackNativeObject(env, trackingInput(), undefined, { deadlineMs: 10,
    fetch: (_url, options) => { upstream = options.signal; return new Promise(() => {}); },
  }), error => error.status === 504);
  assert(upstream.aborted);
  let cancelled = false;
  await assert.rejects(trackNativeObject(env, trackingInput(), undefined, { deadlineMs: 10,
    fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } }),
  }), error => error.status === 504);
  assert(cancelled, "Deadline releases an owned stalled response reader");
  const controller = new AbortController();
  const pending = trackNativeObject(env, trackingInput(), controller.signal, {
    fetch: (_url, options) => { upstream = options.signal; controller.abort(); return new Promise(() => {}); },
  });
  await assert.rejects(pending, error => error.status === 400);
  assert(upstream.aborted);
});

test("tracking stream reader bounds upload and response bytes", async () => {
  let cancelled = false;
  const source = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } }),
    { headers: { "Content-Type": "application/json" } });
  await assert.rejects(readTrackingJson(source, 10, new AbortController().signal), error => error.status === 413);
  assert(cancelled);
});

test("real tracking HTTP route enforces origin/configuration and gates planning capability", async () => {
  const fixture = await nativeFixture({ tracking: true, outputs: [trackingOutput()] });
  const options = () => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trackingInput()) });
  try {
    assert.equal((await (await fixture.fetch("status")).json()).capabilities.objectTracking, true);
    assert.equal((await fixture.fetch("track", { ...options(), headers: { "Content-Type": "application/json", Origin: "https://foreign.example" } })).status, 403);
    assert.equal(fixture.calls.length, 0);
    const response = await fixture.fetch("track", options());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, "sam3.1");
    assert.equal(fixture.calls.length, 1);
  } finally { await fixture.close(); }
  const disabled = await nativeFixture();
  try { assert.equal((await disabled.fetch("track", options())).status, 503); }
  finally { await disabled.close(); }
  for (const supported of [false, true]) {
    const answer = { message: "Ready", operations: [], observations: [], answer: "This is the editor." };
    const fixture = await nativeFixture({ tracking: true, outputs: [{ response: answer }, { response: answer }] });
    try {
      const input = nativeInput(); input.mode = "ask"; input.prompt = "What is this app?";
      assert.equal((await fixture.turn(input, { headers: supported ? { "X-Assistant-Object-Tracking": "1", "X-Assistant-Animation": "1" } : {} })).status, 200);
      assert.equal(fixture.calls[0].input.messages[0].content.includes("SAM 3.1 object tracking is available"), supported);
    } finally { await fixture.close(); }
  }
});
