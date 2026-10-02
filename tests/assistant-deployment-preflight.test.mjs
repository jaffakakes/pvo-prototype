import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";
import { verifyAssistantDeployment } from "../scripts/build/assistant-deployment-preflight.mjs";
import { validateNativeInput } from "../server/assistant/native/policy.js";

const origin = "https://release.example";
const readyStatus = () => ({
  provider: "open-source", available: true, model: "hosted-test-model",
  capabilities: { editing: true, frames: true, transcription: true, wordTiming: false, objectTracking: false },
});
const turn = { message: "I’ll rename the scene.", operations: [
  { kind: "scene.update", sceneId: "release-preflight", changes: { name: "Release preflight ready" } },
], observations: [] };

test("deployment preflight requires hosted editor capabilities and exercises one bounded native turn", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json(readyStatus()) : Response.json(turn);
  };
  const result = await verifyAssistantDeployment({ origin, fetch });
  assert.deepEqual(result.status, readyStatus());
  assert.deepEqual(result.result, turn);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.href, `${origin}/api/assistant/status`);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[1].url.href, `${origin}/api/assistant/turn`);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.Origin, origin);
  assert.equal(calls[1].options.cache, "no-store");
  assert.equal(calls[1].options.redirect, "error");
  assert.equal(calls[1].options.signal, calls[0].options.signal);
  const request = JSON.parse(calls[1].options.body);
  assert.equal(request.mode, "edit");
  assert.equal(request.project.scenes.length, 1);
  assert.deepEqual(request.project.scenes[0].clips, []);
  assert.deepEqual(request.observations, []);
  assert.doesNotThrow(() => validateNativeInput(parseNativeTurnRequest(request)));
});

test("unavailable or incomplete hosted capabilities fail before model inference", async t => {
  const cases = [
    ["unavailable", { ...readyStatus(), available: false }, /not ready/],
    ["editing", { ...readyStatus(), capabilities: { ...readyStatus().capabilities, editing: false } }, /editing/],
    ["frames", { ...readyStatus(), capabilities: { ...readyStatus().capabilities, frames: false } }, /frames/],
    ["transcription", { ...readyStatus(), capabilities: { ...readyStatus().capabilities, transcription: false } }, /transcription/],
  ];
  for (const [name, status, expected] of cases) await t.test(name, async () => {
    let calls = 0;
    await assert.rejects(verifyAssistantDeployment({ origin, fetch: async () => {
      calls += 1;
      return Response.json(status);
    } }), expected);
    assert.equal(calls, 1);
  });
});

test("provider failures and malformed success responses cannot pass the turn check", async t => {
  await t.test("provider failure", async () => {
    let calls = 0;
    await assert.rejects(verifyAssistantDeployment({ origin, fetch: async () => {
      calls += 1;
      return calls === 1 ? Response.json(readyStatus())
        : new Response("private provider diagnostic", { status: 503 });
    } }), error => error.message.includes("HTTP 503") && !error.message.includes("private provider"));
  });
  await t.test("invalid result", async () => {
    let calls = 0;
    await assert.rejects(verifyAssistantDeployment({ origin, fetch: async () => {
      calls += 1;
      return calls === 1 ? Response.json(readyStatus()) : Response.json({ message: "not a native result" });
    } }), /invalid result/);
  });
  await t.test("oversized result", async () => {
    let calls = 0;
    await assert.rejects(verifyAssistantDeployment({ origin, fetch: async () => {
      calls += 1;
      return calls === 1 ? Response.json(readyStatus())
        : Response.json({ ...turn, message: "x".repeat(100_000) });
    } }), /size limit/);
  });
});

test("the preflight deadline aborts a stalled deployment check", async () => {
  let signal;
  await assert.rejects(verifyAssistantDeployment({ origin, timeoutMs: 10, fetch: async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } }), /timed out/);
  assert.equal(signal.aborted, true);
});

test("deployment preflight accepts only an exact HTTPS production origin", async () => {
  for (const value of ["http://release.example", "https://release.example/path", "https://user@release.example"])
    await assert.rejects(verifyAssistantDeployment({ origin: value, fetch: async () => assert.fail("must not fetch") }), /exact HTTPS/);
});
