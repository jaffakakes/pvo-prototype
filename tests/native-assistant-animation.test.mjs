import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeOperation, parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";
import { validateNativeResult } from "../server/assistant/native/policy.js";
import { cloudflareTurn, nativeFixture, nativeInput } from "./native-assistant-server.helpers.mjs";

const key = (time, value, easing = "linear") => ({ time, value, easing });
const operation = () => ({ kind: "animation.set", sceneId: "main", target: { kind: "clip", id: 1 },
  tracks: { opacity: [key(0, 0), key(2, 1)] } });
const draft = () => ({ message: "The clip fades in.", operations: [operation()], observations: [] });

test("native animation validation rejects incompatible layers and malformed or unordered curves", () => {
  assert.doesNotThrow(() => parseNativeOperation(operation()));
  for (const mutate of [
    op => { op.target = { kind: "audio", id: 2 }; },
    op => { op.tracks.opacity[1].time = 0; },
    op => { op.tracks.opacity[0].easing = "script"; },
    op => { op.tracks = {}; },
    op => { op.tracks.opacity = []; },
    op => { op.target.url = "https://untrusted.test"; },
  ]) { const op = operation(); mutate(op); assert.throws(() => parseNativeOperation(op)); }
  const request = nativeInput();
  request.project.scenes[0].clips[0].animation = { tracks: { opacity: [key(10, 0), key(2, 1)] } };
  assert.throws(() => parseNativeTurnRequest(request), /ordered/);
});

test("server checks actual animation target and layer boundaries before returning editor actions", async () => {
  await assert.doesNotReject(validateNativeResult(nativeInput(), draft()));
  const invalidId = draft(); invalidId.operations[0].target.id = 999;
  await assert.rejects(validateNativeResult(nativeInput(), invalidId), /existing animation layer/);
  const invalidTime = draft(); invalidTime.operations[0].tracks.opacity[1].time = 11;
  await assert.rejects(validateNativeResult(nativeInput(), invalidTime), /inside/);
});

test("HTTP capability negotiation offers keyframes only to clients that can execute them", async () => {
  const fixture = await nativeFixture({ outputs: [{ response: draft() }] });
  try {
    const response = await fixture.turn(nativeInput(), { headers: { "X-Assistant-Animation": "1" } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).operations, [operation()]);
    assert.match(fixture.calls[0].input.messages[0].content, /animation\.set/);
    assert.match(fixture.calls[0].input.messages[0].content, /OFFSETS/);
    assert.match(fixture.calls[0].input.messages[0].content, /SCENE TIMELINE/);
  } finally { await fixture.close(); }
  const oldClient = await nativeFixture({ outputs: [{ response: draft() }, { response: draft() }] });
  try {
    const response = await oldClient.turn();
    assert.equal(response.status, 422);
    assert.match(oldClient.calls[0].input.messages[0].content, /keyframe animation is not available/);
    assert.doesNotMatch(oldClient.calls[0].input.messages[0].content, /animation\.set/);
    assert.match(JSON.stringify(oldClient.calls[1]), /Layer animation is unavailable/);
  } finally { await oldClient.close(); }
});

test("tracking requests and follow require the live capability and actual current observation identities", async () => {
  const tracking = { kind: "object_tracking", sceneId: "main", clipId: 1, start: 0, end: 2,
    target: { kind: "text", text: "the red car" } };
  const response = { message: "Inspecting the car", operations: [], observations: [tracking] };
  let calls = 0;
  const ai = { run: async () => { calls++; return { response }; } };
  await assert.rejects(cloudflareTurn(nativeInput(), { ai, signal: new AbortController().signal,
    animation: true, objectTracking: false }), error => error.status === 422);
  assert.equal(calls, 2);
  assert.deepEqual((await cloudflareTurn(nativeInput(), { ai, signal: new AbortController().signal,
    animation: true, objectTracking: true })).observations, [tracking]);
  const follow = { kind: "animation.follow", sceneId: "main", target: { kind: "clip", id: 1 },
    observationId: "tool-generated-id", anchor: "center", offsetX: 0, offsetY: 0 };
  await assert.rejects(validateNativeResult(nativeInput(), { ...response, observations: [], operations: [follow] }), /actual completed/);
  const request = nativeInput();
  request.observations = [{ kind: "object_tracking", sceneId: "main", clipId: 1, start: 0, end: 2,
    id: "tool-generated-id", model: "sam3.1", frameCount: 2,
    samples: [0, 2].map(time => ({ time, visible: true, x: 0.5, y: 0.5, width: 0.2, height: 0.2, score: 0.9 })) }];
  assert.doesNotThrow(() => parseNativeTurnRequest(request));
  await assert.doesNotReject(validateNativeResult(request, { ...response, observations: [], operations: [follow] }));
  assert.throws(() => parseNativeOperation({ ...follow, target: { kind: "audio", id: 1 } }), /unsupported/);
});
