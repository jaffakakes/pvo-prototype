import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { parseNativeOperation, parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/animation/tracking.ts';
  export * from './editor/src/domain/animation/trackingEvidence.ts';
  export * from './editor/src/domain/animation/simplify.ts';
  export * from './editor/src/domain/animation/targets.ts';
  export * from './editor/src/domain/assistant/native/batch.ts';
  export * from './editor/src/domain/assistant/native/context.ts';
  export * from './editor/src/infrastructure/assistant/runNativeTask.ts';
  export { evaluateAnimation } from './packages/pvo-animation/index.js';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const key = (time, value, easing = "linear") => ({ time, value, easing });
const sample = (time, x, y = 0.5, visible = true) => ({ time, x, y, visible, width: 0.2, height: 0.2, score: visible ? 0.9 : 0 });
function scene() { return { id: "main", name: "Main", parent: null, muted: false, sound: 0,
  clips: [{ id: 1, url: "blob:source", color: "#000", srcDur: 30, in: 4, out: 24, speed: 2,
    width: 320, height: 240, fit: "cover", zoom: 1, mirror: false }], audioClips: [], components: [],
  texts: [{ id: 2, text: "Label", color: 2, start: 1, end: 9, x: 50, y: 50 }],
}; }
function project(value = scene()) { return { scenes: [value], currentSceneId: "main", ratio: "9:16", allowedDomains: [] }; }
function observation(samples = [sample(2, 0.2), sample(3, 0.4), sample(4, 0.6)]) { return {
  kind: "object_tracking", id: "measured-track", sceneId: "main", clipId: 1,
  start: samples[0].time, end: samples.at(-1).time, model: "sam3.1", samples, frameCount: samples.length,
}; }
const target = { kind: "text", id: 2 };
const attachment = { anchor: "top", offsetX: 2, offsetY: -3 };
const follow = () => ({ kind: "animation.follow", sceneId: "main", target, observationId: "measured-track", ...attachment });
function options(evidence = []) { let id = 100; return { createId: () => id++, advancedEditingEnabled: false,
  compile: async () => { throw Error("Not expected"); }, trackingEvidence: evidence }; }
const evidence = (snapshot, observed = observation()) => [{ observation: observed,
  requestTarget: { kind: "text", text: "car" },
  fingerprint: api.nativeTrackingFingerprint(snapshot, observed.sceneId, observed.clipId) }];

test("measured box centers become exact offset keys with a top anchor, preserving outside range and other animation", () => {
  const original = scene();
  original.texts[0].animation = { tracks: { rotation: [key(0, 30)], opacity: [key(0, 0.5)] } };
  const next = api.followObjectTracking(original, target, observation(), attachment);
  const layer = next.texts[0];
  const at = time => api.evaluateAnimation(layer.animation, time - layer.start);
  assert.equal(at(3).x, -8, "40% tracked center +2% offset -50% static center");
  assert.equal(at(3).y, -13, "50% center -10% half height -3% offset -50% static center");
  assert.equal(at(1.5).x, 0);
  assert.equal(at(5).x, 0);
  assert.equal(at(3).rotation, 30);
  assert.equal(at(3).opacity, 0.5, "Continuous tracks preserve authored opacity exactly");
  assert.deepEqual(original.texts[0].animation.tracks, { rotation: [key(0, 30)], opacity: [key(0, 0.5)] });
});

test("tracking loss hides overlays, holds their position, and never interpolates a guessed path through the gap", () => {
  const tracked = observation([sample(2, 0.2), sample(3, 0.3, 0.5, false), sample(4, 0.4, 0.5, false), sample(5, 0.8)]);
  const next = api.followObjectTracking(scene(), target, tracked, { ...attachment, anchor: "center", offsetX: 0, offsetY: 0 });
  const at = time => api.evaluateAnimation(next.texts[0].animation, time - 1);
  assert.equal(at(2.9).opacity, 1);
  assert.equal(at(3).opacity, 0);
  assert.equal(at(4.5).opacity, 0);
  assert.equal(at(4.5).x, -30);
  assert.equal(at(5).opacity, 1);
  assert.equal(at(5).x, 30);
  const conflict = scene(); conflict.texts[0].animation = { tracks: { opacity: [key(0, 0.5)] } };
  assert.throws(() => api.followObjectTracking(conflict, target, tracked, attachment), /already has an opacity/);
});

test("one confident frame does not establish a track; multiple confident frames can be followed before loss", () => {
  const original = scene();
  const samples = Array.from({ length: 46 }, (_, index) => sample(2 + index / 15, 0.5, 0.5, index === 0));
  // A second reported box below the confidence threshold is still missing evidence.
  samples[1] = { ...samples[1], visible: true, score: 0.24 };
  const measured = observation(samples);
  assert.throws(() => api.followObjectTracking(original, target, measured, attachment),
    /The object was found but could not be followed\. Pick a clearer object or a shorter range\./);
  assert.equal(original.texts[0].animation, undefined);
  samples[1] = { ...samples[1], x: 0.6, score: 0.9 };
  const followed = api.followObjectTracking(original, target, measured, attachment);
  const at = time => api.evaluateAnimation(followed.texts[0].animation, time - original.texts[0].start);
  assert.equal(at(samples[1].time).x, 12);
  assert.equal(at(samples[2].time).x, 12, "Later loss holds the last measured attachment");
  assert.equal(at(samples[2].time).opacity, 0, "Loss still hides an overlay after a real tracked interval");
});

test("tracking the source clip reframes its camera, preserves gain/scale and holds footage through loss", () => {
  const original = scene();
  original.clips[0].animation = { tracks: { x: [key(4, 5)], scaleX: [key(4, 2)], gain: [key(4, 0.4)] } };
  const tracked = observation([sample(2, 0.2), sample(3, 0, 0, false), sample(4, 0.6)]);
  const next = api.followObjectTracking(original, { kind: "clip", id: 1 }, tracked, { anchor: "center", offsetX: 0, offsetY: 0 });
  const at = sceneTime => api.evaluateAnimation(next.clips[0].animation, 4 + sceneTime * 2);
  assert.equal(at(2).x, 35, "Original +5 offset plus center correction from20% to50%");
  assert.equal(at(3.5).x, 35);
  assert.equal(at(4).x, -5);
  assert.equal(at(3.5).opacity, 1, "Missing subject must not black out the footage");
  assert.equal(at(3).scaleX, 2);
  assert.equal(at(3).gain, 0.4);
  assert.equal(at(1).x, 5);
});

test("RDP preserves observed interpolation error and gap boundaries; overly complex curves are rejected", () => {
  const smooth = Array.from({ length: 121 }, (_, i) => sample(i / 15, 0.5 + 0.1 * Math.sin(i / 15)));
  const source = scene(); source.texts[0] = { ...source.texts[0], start: 0, end: 10 };
  const next = api.followObjectTracking(source, target, observation(smooth), { anchor: "center", offsetX: 0, offsetY: 0 });
  assert.ok(next.texts[0].animation.tracks.x.length < smooth.length / 2);
  for (const point of smooth) assert.ok(Math.abs(api.evaluateAnimation(next.texts[0].animation, point.time).x - (point.x * 100 - 50)) <= 0.150001);
  const noisy = Array.from({ length: 151 }, (_, i) => sample(i / 15, i % 2 ? 0.8 : 0.2));
  assert.throws(() => api.followObjectTracking(source, target, observation(noisy), attachment), /too complex/);
  const eased = scene(); eased.texts[0].animation = { tracks: { x: [key(0, 0, "ease-in"), key(8, 20)] } };
  assert.throws(() => api.followObjectTracking(eased, target, observation(), attachment), /existing eased/);
});

test("follow accepts only actual fresh evidence, with source changes invalidating it and unrelated overlays preserving it", async () => {
  const before = project();
  const measured = evidence(before);
  assert.doesNotThrow(() => parseNativeOperation(follow()));
  await assert.rejects(api.prepareNativeBatch(before, [follow()], options()), /completed, current/);
  const after = await api.prepareNativeBatch(before, [follow()], options(measured));
  assert.equal(after.receipts[0].target.kind, "text");
  assert.equal(before.scenes[0].texts[0].animation, undefined);
  const unrelated = project(); unrelated.scenes[0].texts[0].text = "Changed wording";
  assert.equal(api.nativeTrackingFingerprint(unrelated, "main", 1), measured[0].fingerprint);
  for (const mutate of [p => { p.ratio = "1:1"; }, p => { p.scenes[0].clips[0].speed = 1; },
    p => { p.scenes[0].clips[0].mirror = true; }, p => { p.scenes[0].clips[0].animation = { tracks: { x: [key(4, 2)] } }; }]) {
    const changed = project(); mutate(changed);
    await assert.rejects(api.prepareNativeBatch(changed, [follow()], options(measured)), /completed, current/);
  }
  const cameraFollow = { ...follow(), target: { kind: "clip", id: 1 } };
  await assert.rejects(api.prepareNativeBatch(before, [cameraFollow, follow()], options(measured)), /completed, current/,
    "Reframing the video invalidates the original canvas measurements before a later operation in the same batch");
  assert.equal(before.scenes[0].clips[0].animation, undefined, "A rejected batch leaves the original project untouched");
  const wire = { mode: "edit", prompt: "Follow the car", history: [], project: api.nativeProjectContext(before, 0), observations: [observation()] };
  assert.doesNotThrow(() => parseNativeTurnRequest(wire));
  assert.throws(() => parseNativeTurnRequest({ ...wire, observations: [observation([sample(2, 0.2), sample(2, 0.3), sample(4, 0.6)])] }), /ordered/);
});

test("agent loop carries only registered fresh observations into follow preparation and commits once after review", async () => {
  const original = project();
  const observed = observation();
  let round = 0;
  let committed = null;
  const result = await api.runNativeTask({ prompt: "Follow the car with the label", mode: "edit", history: [] }, {
    snapshot: () => original, playhead: () => 0,
    selection: () => ({ clipId: 1, textId: 2, componentId: null, audioId: null }),
    turn: async request => {
      if (round++ === 0) return { message: "Inspecting the car", operations: [], observations: [
        { kind: "object_tracking", sceneId: "main", clipId: 1, start: 2, end: 4, target: { kind: "text", text: "car" } }] };
      assert.equal(request.observations[0].id, observed.id);
      if (round === 2) return { message: "Following measured motion", operations: [follow()], observations: [] };
      assert.ok(request.project.scenes[0].texts[0].animation);
      return { message: "The label follows the car", operations: [], observations: [] };
    },
    observe: async () => observed,
    prepare: async (project, operations, signal, trackingEvidence) => api.prepareNativeBatch(project, operations, { ...options(trackingEvidence), signal }),
    commit: batch => { assert.equal(committed, null); committed = batch; }, progress() {}, report() {},
  }, new AbortController().signal);
  assert.ok(committed);
  assert.equal(result.batch.operations.length, 1);
  assert.equal(original.scenes[0].texts[0].animation, undefined);
  assert.equal(round, 3);
});
