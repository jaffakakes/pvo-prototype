import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/animation/trackedAuthoring.ts';
  export * from './editor/src/domain/animation/trackingMetadata.ts';
  export * from './editor/src/domain/animation/trackingEvidence.ts';
  export * from './editor/src/domain/animation/authoring.ts';
  export * from './editor/src/domain/animation/editing.ts';
  export * from './editor/src/domain/assistant/native/context.ts';
  export * from './editor/src/domain/project/snapshot.ts';
  export * from './editor/src/domain/scenes/duplicate.ts';
  export * from './editor/src/domain/export/manifest.ts';
  export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';
  export * from './editor/src/state/animation/commands.ts';
  export * from './editor/src/state/animation/trackingCommands.ts';
  export { evaluateAnimation } from './packages/pvo-animation/index.js';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { useAssistant } from './editor/src/state/assistant/assistantStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const target = { kind: "text", id: 2 };
const requestTarget = { kind: "text", text: "the car" };
const attachment = { anchor: "center", offsetX: 0, offsetY: 0 };
const key = (time, value, easing = "linear") => ({ time, value, easing });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
function fixture() {
  return { scenes: [{ id: "main", name: "Main", parent: null, muted: false, sound: 0,
    clips: [{ id: 1, url: "blob:source", color: "#000", srcDur: 30, in: 4, out: 24, speed: 2,
      width: 320, height: 240, fit: "cover", zoom: 1, mirror: false }],
    texts: [{ id: 2, text: "Car", color: 0, start: 1, end: 9, x: 45, y: 30 }], components: [], audioClips: [],
  }], currentSceneId: "main", ratio: "9:16", allowedDomains: [] };
}
function observation(gap = false) {
  const samples = Array.from({ length: 91 }, (_, index) => {
    const visible = !gap || index < 32 || index >= 52;
    return { time: 2 + index / 15, visible, x: visible ? .2 + index / 180 : 0, y: visible ? .5 : 0,
      width: visible ? .1 : 0, height: visible ? .2 : 0, score: visible ? .9 : 0 };
  });
  return { kind: "object_tracking", id: "observed-car", sceneId: "main", clipId: 1,
    start: 2, end: 8, model: "sam3.1", samples, frameCount: samples.length };
}
function tracked(layerTarget = target, gap = false, project = fixture()) {
  return { ...project, scenes: [api.createTrackedAnimation(project, layerTarget, observation(gap), attachment, requestTarget)] };
}
const state = () => api.useCapture.getState();
const current = () => state().scenes[0];
function reset(project) {
  api.useCapture.setState(api.initial()); api.useAssistant.setState({ phase: "idle" });
  state().patch({ ...project, screen: "editor", selText: 2 });
}

test("tracking density yields regular paired keys, preserves initial separation and refits saved actual measurements", () => {
  const project = tracked();
  const tracking = api.getLayerTracking(project.scenes[0], target);
  assert.equal(tracking.step, 1); assert.equal(tracking.count, 7);
  assert.equal(tracking.observation.samples.length, 91, "Keep actual evidence, not the downsampled authoring curve");
  assert.deepEqual(tracking.times, [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(api.readAuthoringValue(project.scenes[0], target, "position", 2), { x: 45, y: 30 });
  close(api.readAuthoringValue(project.scenes[0], target, "position", 5).x, 70);
  const half = api.refitTrackedAnimation(project, target, .5);
  assert.equal(api.getLayerTracking(half, target).count, 13);
  const sparse = api.refitTrackedAnimation({ ...project, scenes: [half] }, target, 2);
  assert.equal(api.getLayerTracking(sparse, target).count, 4);
  assert.deepEqual(api.readAuthoringValue(sparse, target, "position", 2), { x: 45, y: 30 });
  assert.equal(api.getLayerTracking(project.scenes[0], target).count, 7, "Re-fit does not mutate its input");
});

test("loss boundaries survive a sparse refit and later manual visibility edits are never overwritten", () => {
  const project = tracked(target, true);
  const next = api.refitTrackedAnimation(project, target, 2);
  const at = time => api.evaluateAnimation(next.texts[0].animation, time - 1);
  close(at(4.05).opacity, 1); close(at(4.14).opacity, 0); close(at(5.4).opacity, 0); close(at(5.47).opacity, 1);
  close(at(4.14).x, at(5.4).x);
  assert.ok(api.getLayerTracking(next, target).times.includes(2 + 32 / 15), "First missing frame is an explicit boundary");
  const changed = api.changeLayerAnimation(next, target, { kind: "set", property: "opacity", time: 3, value: .5, easing: "linear" });
  assert.throws(() => api.refitTrackedAnimation({ ...project, scenes: [changed] }, target, 1), /already has an opacity/);
});

test("camera density changes never apply correction twice, while a later source edit requires new evidence", () => {
  const camera = { kind: "clip", id: 1 };
  const initial = fixture(); initial.scenes[0].clips[0].animation = { tracks: { x: [key(4, 5)], gain: [key(4, .4)] } };
  let project = tracked(camera, false, initial);
  close(api.evaluateAnimation(project.scenes[0].clips[0].animation, 8).x, 35);
  for (const step of [.5, 2, 1]) {
    project = { ...project, scenes: [api.refitTrackedAnimation(project, camera, step)] };
    close(api.evaluateAnimation(project.scenes[0].clips[0].animation, 8).x, 35);
    close(api.evaluateAnimation(project.scenes[0].clips[0].animation, 8).gain, .4);
    assert.equal(api.getLayerTracking(project.scenes[0], camera).sourceFingerprint, api.nativeTrackingFingerprint(project, "main", 1));
  }
  project.scenes[0].texts[0].text = "Unrelated edit";
  assert.doesNotThrow(() => api.refitTrackedAnimation(project, camera, .5));
  project.scenes[0].clips[0].mirror = true;
  assert.throws(() => api.refitTrackedAnimation(project, camera, .5), /video changed/);
});

test("generated provenance follows manual moves, survives gesture cancel, and disappears with all position curves", () => {
  reset(tracked());
  const saved = JSON.stringify(current());
  const gesture = api.beginAnimationGesture(target);
  assert.equal(gesture.moveKey("position", 3, 3.3), true);
  assert.ok(api.getLayerTracking(current(), target).times.includes(3.3));
  gesture.cancel(); assert.equal(JSON.stringify(current()), saved);
  api.moveAuthoringKey(target, "position", 3, 3.3);
  assert.ok(api.getLayerTracking(current(), target).times.includes(3.3));
  state().undo(); assert.equal(JSON.stringify(current()), saved);
  let cleared = api.changeLayerAnimation(current(), target, { kind: "clear", property: "x" });
  assert.ok(cleared.texts[0].animationTracking, "Paired Y keys still carry provenance");
  cleared = api.changeLayerAnimation(cleared, target, { kind: "clear", property: "y" });
  assert.equal(cleared.texts[0].animationTracking, undefined);
});

test("density and detach commands each produce one Undo and detaching preserves editable motion", () => {
  reset(tracked());
  assert.equal(api.refitLayerTracking(target, .5), true); assert.equal(state().past.length, 1);
  assert.equal(api.refitLayerTracking(target, .5), false); assert.equal(state().past.length, 1);
  const animation = structuredClone(current().texts[0].animation);
  assert.equal(api.detachLayerTracking(target), true); assert.equal(state().past.length, 2);
  assert.equal(api.getLayerTracking(current(), target), null);
  assert.deepEqual(current().texts[0].animation, animation);
  state().undo(); assert.equal(api.getLayerTracking(current(), target).step, .5);
  state().undo(); assert.equal(api.getLayerTracking(current(), target).step, 1);
});

test("saved observations deep clone, survive media address remapping, and malformed provenance is rejected", () => {
  reset(tracked());
  const draft = api.captureCheckpoint(state());
  current().texts[0].animationTracking.observation.samples[0].x = .9;
  assert.equal(draft.project.scenes[0].texts[0].animationTracking.observation.samples[0].x, .2);
  const record = api.storeCheckpoint(draft, new Map([["blob:source", "asset:source"]]), 123);
  api.validateCheckpoint(record);
  const restored = api.restoreCheckpoint(record, new Map([["asset:source", "blob:restored"]]));
  assert.doesNotThrow(() => api.refitTrackedAnimation(restored.project, target, .5));
  const invalid = structuredClone(record);
  invalid.project.scenes[0].texts[0].animationTracking.generatedTimes = [2, 1];
  assert.throws(() => api.validateCheckpoint(invalid), /tracking metadata/);
  const stale = structuredClone(draft); stale.project.scenes[0].clips[0].mirror = true;
  const staleRecord = api.storeCheckpoint(stale, new Map([["blob:source", "asset:source"]]), 123);
  const staleRestored = api.restoreCheckpoint(staleRecord, new Map([["asset:source", "blob:new"]]));
  assert.throws(() => api.refitTrackedAnimation(staleRestored.project, target, .5), /video changed/);
});

test("the assistant context and published manifest omit saved observation payloads", () => {
  const project = tracked();
  const context = api.nativeProjectContext(project, 0);
  assert.equal(JSON.stringify(context).includes("observed-car"), false);
  assert.equal(JSON.stringify(context).includes("animationTracking"), false);
  const manifest = api.buildPvoManifest(project, [{ scene: project.scenes[0], assetId: "video", name: "video.mp4", type: "video/mp4" }], new Map());
  assert.equal(JSON.stringify(manifest).includes("animationTracking"), false);
  assert.equal(JSON.stringify(manifest).includes("observed-car"), false);
});

test("a duplicated scene keeps independent editable keys and remaps the source for Re-track", () => {
  const project = tracked();
  let id = 100;
  const copy = api.duplicateSceneData(project.scenes[0], project.scenes, "copy", () => id++);
  const copiedTarget = { kind: "text", id: copy.texts[0].id };
  const metadata = api.getLayerTracking(copy, copiedTarget);
  assert.equal(metadata.observation.sceneId, "copy");
  assert.equal(metadata.observation.clipId, copy.clips[0].id);
  assert.deepEqual(copy.texts[0].animation, project.scenes[0].texts[0].animation);
  assert.throws(() => api.refitTrackedAnimation({ ...project, currentSceneId: "copy", scenes: [project.scenes[0], copy] }, copiedTarget, .5), /video changed/);
  copy.texts[0].animationTracking.observation.samples[0].x = .9;
  assert.equal(project.scenes[0].texts[0].animationTracking.observation.samples[0].x, .2);
});
