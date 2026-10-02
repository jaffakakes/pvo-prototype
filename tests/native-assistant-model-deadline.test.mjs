import assert from "node:assert/strict";
import test from "node:test";
import { nativeModels } from "../server/assistant/native/models.js";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { nativeInput } from "./native-assistant-server.helpers.mjs";

function response(content) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }] });
}

test("Runpod has a 60-second text attempt while Cloudflare keeps its 25-second attempt", () => {
  assert.equal(nativeModels({ ASSISTANT_PROVIDER: "runpod", RUNPOD_API_KEY: "server-test-key" }).textAttemptMs, 60000);
  assert.equal(nativeModels({ ASSISTANT_PROVIDER: "cloudflare", AI: { run() {} } }).textAttemptMs, 25000);
});

test("a Runpod text call can pass 25 seconds but still aborts at its 60-second deadline without retrying", async t => {
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
  const task = nativeAssistantTurn(nativeInput(), { models, signal: new AbortController().signal });
  await ready;
  t.mock.timers.tick(25001);
  assert.equal(upstreamSignal.aborted, false, "Measured Runpod latency may exceed the former 25-second limit");
  t.mock.timers.tick(34999);
  await assert.rejects(task, error => error.status === 504);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(calls, 1);
});

test("Runpod primary and completion calls still share the unchanged 90-second total deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let firstStarted;
  let reviewStarted;
  let reviewSignal;
  let calls = 0;
  const primary = new Promise(resolve => { firstStarted = resolve; });
  const review = new Promise(resolve => { reviewStarted = resolve; });
  const models = nativeModels({ ASSISTANT_PROVIDER: "runpod", RUNPOD_API_KEY: "server-test-key" }, {
    fetch: async (_url, { signal }) => {
      if (++calls === 1) {
        firstStarted();
        return new Promise(resolve => setTimeout(() => resolve(response({
          message: "The existing scene is ten seconds long.", operations: [], observations: [],
        })), 40000));
      }
      reviewSignal = signal;
      reviewStarted();
      return new Promise(() => {});
    },
  });
  const task = nativeAssistantTurn({ ...nativeInput(), mode: "ask" }, { models, signal: new AbortController().signal });
  await primary;
  t.mock.timers.tick(40000);
  await review;
  t.mock.timers.tick(49999);
  assert.equal(reviewSignal.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(task, error => error.status === 504);
  assert.equal(reviewSignal.aborted, true);
  assert.equal(calls, 2, "A total deadline does not start another repair or model call");
});
