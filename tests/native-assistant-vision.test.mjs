import assert from "node:assert/strict";
import test from "node:test";
import { inspectNativeFrames } from "../server/assistant/native/vision.js";
import { nativeModels } from "../server/assistant/native/models.js";
import { nativeInput, frameObservation } from "./native-assistant-server.helpers.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
function input() {
  const frames = Array.from({ length: 6 }, (_, index) => ({ ...frameObservation().frames[0],
    sceneTime: index + 1, sourceTime: 2 + (index + 1) * 2, dataUrl: `data:image/png;base64,frame${index}`,
  }));
  return { ...nativeInput(), observations: [
    { ...frameObservation(), start: 0, end: 3, frames: frames.slice(0, 3) },
    { kind: "transcript", sceneId: "main", start: 0, end: 6, text: "Supplied speech." },
    { ...frameObservation(), start: 3, end: 6, frames: frames.slice(3) },
  ] };
}
function deferredModels() {
  const calls = [];
  let active = 0;
  let maximum = 0;
  return { calls, maximum: () => maximum, models: {
    frameAttemptMs: 60000,
    describeFrame: (value, signal) => {
      active++;
      maximum = Math.max(maximum, active);
      return new Promise((resolve, reject) => { calls.push({ value, signal, resolve, reject }); })
        .finally(() => { active--; });
    },
  } };
}

test("frame inspections run at concurrency three and retain sample order despite out-of-order completion", async () => {
  const request = input();
  const f = deferredModels();
  const task = inspectNativeFrames(request, { models: f.models, signal: new AbortController().signal });
  await flush();
  assert.equal(f.calls.length, 3, "Only the first three frames start together");
  f.calls[2].resolve("Frame 3");
  await flush();
  assert.equal(f.calls.length, 4, "A completed slot starts the next frame across observation boundaries");
  f.calls[0].resolve("Frame 1");
  f.calls[3].resolve("Frame 4");
  await flush();
  assert.equal(f.calls.length, 6);
  f.calls[5].resolve("Frame 6");
  f.calls[4].resolve("Frame 5");
  f.calls[1].resolve("Frame 2");
  const result = await task;
  assert.equal(f.maximum(), 3);
  assert.deepEqual(result[0].frames.map(frame => frame.description), ["Frame 1", "Frame 2", "Frame 3"]);
  assert.deepEqual(result[2].frames.map(frame => frame.description), ["Frame 4", "Frame 5", "Frame 6"]);
  assert.deepEqual(result[1], request.observations[1]);
  assert.deepEqual(result[2].frames.map(frame => [frame.sceneTime, frame.sourceTime]), [[4, 10], [5, 12], [6, 14]]);
  assert.doesNotMatch(JSON.stringify(result), /data:image/);
  assert.ok(request.observations[0].frames[0].dataUrl, "The supplied observations are not mutated");
});

test("one invalid frame aborts active siblings, starts no queued frames and cannot return partial evidence", async () => {
  const f = deferredModels();
  const task = inspectNativeFrames(input(), { models: f.models, signal: new AbortController().signal });
  await flush();
  const rejected = assert.rejects(task, error => error.status === 422);
  f.calls[1].resolve(" ");
  await rejected;
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.calls[2].signal.aborted, true);
  f.calls[0].resolve("Late valid frame");
  f.calls[2].resolve("Another late valid frame");
  await flush();
  assert.equal(f.calls.length, 3, "Late provider results cannot resume inspection");
});

test("Stop aborts every active frame and prevents any queued inspections", async () => {
  const f = deferredModels();
  const controller = new AbortController();
  const task = inspectNativeFrames(input(), { models: f.models, signal: controller.signal });
  await flush();
  const rejected = assert.rejects(task, error => error.status === 400);
  controller.abort();
  await rejected;
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.signal.aborted));
  for (const call of f.calls) call.resolve("Late provider result");
  await flush();
  assert.equal(f.calls.length, 3);
});

test("Runpod frame deadlines allow observed latency beyond 20 seconds but still abort at 60 seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  let upstreamSignal;
  let calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const models = nativeModels({ ASSISTANT_PROVIDER: "runpod", RUNPOD_API_KEY: "server-test-key" }, {
    fetch: async (_url, { signal }) => {
      calls++;
      upstreamSignal = signal;
      started();
      return new Promise(() => {});
    },
  });
  assert.equal(models.frameAttemptMs, 60000);
  assert.equal(nativeModels({ ASSISTANT_PROVIDER: "cloudflare", AI: { run() {} } }).frameAttemptMs, 20000);
  const task = inspectNativeFrames({ ...nativeInput(), observations: [frameObservation()] }, {
    models, signal: new AbortController().signal,
  });
  await ready;
  t.mock.timers.tick(20001);
  assert.equal(upstreamSignal.aborted, false);
  t.mock.timers.tick(39999);
  await assert.rejects(task, error => error.status === 504);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(calls, 1);
});
