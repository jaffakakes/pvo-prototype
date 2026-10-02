import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { parseNativeOperation, parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/animation/editing.ts';
  export * from './editor/src/domain/animation/targets.ts';
  export * from './editor/src/domain/clips/editing.ts';
  export * from './editor/src/domain/clips/trim.ts';
  export * from './editor/src/domain/audio/editing.ts';
  export * from './editor/src/domain/project/snapshot.ts';
  export * from './editor/src/domain/scenes/duplicate.ts';
  export * from './editor/src/domain/assistant/native/batch.ts';
  export * from './editor/src/domain/assistant/native/context.ts';
  export * from './editor/src/domain/assistant/native/receipts.ts';
  export * from './editor/src/state/editing/animationCommands.ts';
  export * from './editor/src/state/assistant/nativeCommands.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { useAssistant } from './editor/src/state/assistant/assistantStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { projectSnapshot } from './editor/src/state/project/history.ts';
  export { evaluateAnimation } from './packages/pvo-animation/index.js';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const key = (time, value, easing = "linear") => ({ time, value, easing });
function scene() {
  return { id: "main", name: "Main", parent: null, muted: false, sound: 1,
    clips: [{ id: 1, url: "blob:test", srcDur: 30, in: 2, out: 22, speed: 2,
      color: "#000", zoom: 1, mirror: false, width: 320, height: 240, fit: "contain" }],
    audioClips: [{ id: 2, name: "Audio", url: "blob:test", srcDur: 30, in: 4, out: 20, speed: 2, start: 1, muted: false }],
    texts: [{ id: 3, text: "Title", color: 2, start: 2, end: 8, x: 50, y: 50 }],
    components: [{ id: "note", type: "tooltip", sceneId: "main", at: 3, dur: 5, x: 50, y: 50, fields: { text: "Note" } }],
  };
}
const snapshot = () => api.projectSnapshot(api.useCapture.getState());
function reset() {
  api.useCapture.setState(api.initial());
  api.useAssistant.setState({ phase: "idle" });
  api.useCapture.getState().patch({ scenes: [scene()], screen: "editor", currentSceneId: "main" });
}
function options() { let id = 50; return { createId: () => id++, advancedEditingEnabled: false, compile: async () => { throw Error("Not expected"); } }; }

test("all five layer kinds convert scene-time commands to their canonical clock", () => {
  for (const [target, property, expected] of [
    [{ kind: "clip", id: 1 }, "x", 10], [{ kind: "audio", id: 2 }, "gain", 10],
    [{ kind: "text", id: 3 }, "opacity", 2], [{ kind: "component", id: "note" }, "rotation", 1],
    [{ kind: "music" }, "gain", 4],
  ]) {
    const original = scene();
    const result = api.changeLayerAnimation(original, target, { kind: "set", property, time: 4, value: 0.5, easing: "ease-in" });
    const info = api.getAnimationTarget(result, target);
    assert.equal(info.animation.tracks[property][0].time, expected);
    assert.equal(api.animationSceneTime(info, expected), 4);
    assert.equal(api.getAnimationTarget(original, target).animation, undefined);
  }
  assert.throws(() => api.changeLayerAnimation(scene(), { kind: "audio", id: 2 }, { kind: "set", property: "x", time: 4, value: 1, easing: "linear" }), /not supported/);
  assert.throws(() => api.changeLayerAnimation(scene(), { kind: "text", id: 3 }, { kind: "set", property: "x", time: 1, value: 1, easing: "linear" }), /inside/);
});

test("media curves retain physical source alignment through trim, split, speed and moves", () => {
  const original = api.changeLayerAnimation(scene(), { kind: "clip", id: 1 }, { kind: "tracks", tracks: { x: [key(0, 0), key(10, 100)] } });
  const expected = sourceTime => api.evaluateAnimation(original.clips[0].animation, sourceTime).x;
  const split = api.splitClipAt(original.clips, 4, () => 10);
  assert.deepEqual(split.clips.map(clip => [clip.in, clip.out]), [[2, 10], [10, 22]]);
  for (const clip of split.clips) for (const at of [clip.in, (clip.in + clip.out) / 2, clip.out])
    assert.equal(api.evaluateAnimation(clip.animation, at).x, expected(at));
  const trimmed = api.trimClip(original.clips[0], "l", 2, 0.3);
  const changed = { ...original, clips: [{ ...trimmed, speed: 4 }] };
  const info = api.getAnimationTarget(changed, { kind: "clip", id: 1 });
  assert.equal(api.animationTime(info, 1), 10);
  assert.equal(api.evaluateAnimation(info.animation, api.animationTime(info, 1)).x, 40);
  const audioScene = api.changeLayerAnimation(original, { kind: "audio", id: 2 }, { kind: "tracks", tracks: { gain: [key(1, 0), key(9, 1)] } });
  const [left, right] = api.splitAudio(audioScene.audioClips[0], 5, 11);
  const moved = api.dragAudio(right, "move", 3);
  const audioInfo = api.getAnimationTarget({ ...audioScene, audioClips: [left, moved] }, { kind: "audio", id: 11 });
  assert.equal(api.animationTime(audioInfo, moved.start), 12);
  assert.equal(api.evaluateAnimation(audioInfo.animation, 12).gain, 0.5);
});

test("overlay motion moves with its layer; copies and history snapshots have independent curves", () => {
  let original = scene();
  original = api.changeLayerAnimation(original, { kind: "text", id: 3 }, { kind: "tracks", tracks: { y: [key(2, -10), key(4, 10)] } });
  original = api.changeLayerAnimation(original, { kind: "component", id: "note" }, { kind: "tracks", tracks: { opacity: [key(3, 0), key(4, 1)] } });
  const moved = { ...original, texts: [{ ...original.texts[0], start: 6, end: 12 }] };
  const info = api.getAnimationTarget(moved, { kind: "text", id: 3 });
  assert.equal(api.evaluateAnimation(info.animation, api.animationTime(info, 7)).y, 0);
  const copy = api.duplicateSceneData(original, [original], "copy", (() => { let id = 100; return () => id++; })());
  copy.texts[0].animation.tracks.y[0].value = -20;
  copy.components[0].animation.tracks.opacity[0].value = 0.3;
  assert.equal(original.texts[0].animation.tracks.y[0].value, -10);
  assert.equal(original.components[0].animation.tracks.opacity[0].value, 0);
  const snap = api.cloneScenes([original])[0];
  snap.texts[0].animation.tracks.y[1].value = 99;
  assert.equal(original.texts[0].animation.tracks.y[1].value, 10);
});

test("audio extraction preserves only its gain curve, not the video's visual motion", () => {
  const original = scene();
  original.clips[0].animation = { tracks: { x: [key(2, 12)], gain: [key(2, 0), key(22, 1)] } };
  const extracted = api.extractClipAudio(original.clips, 0, 7, false, 0.5);
  assert.deepEqual(extracted.audio.animation.tracks, { gain: original.clips[0].animation.tracks.gain });
  extracted.audio.animation.tracks.gain[0].value = 0.25;
  assert.equal(original.clips[0].animation.tracks.gain[0].value, 0);
});

test("manual add, replace, move, remove and clear use one atomic Undo each and reject conflicting moves", () => {
  reset();
  const target = { kind: "text", id: 3 };
  assert.equal(api.setLayerKeyframe(target, "opacity", 2, 0), true);
  assert.equal(api.setLayerKeyframe(target, "opacity", 3, 1), true);
  assert.equal(api.setLayerKeyframe(target, "opacity", 3, 1), false, "No-op does not create history");
  assert.equal(api.useCapture.getState().past.length, 2);
  assert.throws(() => api.moveLayerKeyframe(target, "opacity", 2, 3), /already exists/);
  assert.equal(api.useCapture.getState().past.length, 2);
  assert.equal(api.moveLayerKeyframe(target, "opacity", 3, 4), true);
  assert.equal(api.useCapture.getState().texts[0].animation.tracks.opacity[1].time, 2);
  api.useCapture.getState().undo();
  assert.equal(api.useCapture.getState().texts[0].animation.tracks.opacity[1].time, 1);
  api.removeLayerKeyframe(target, "opacity", 3);
  assert.equal(api.useCapture.getState().texts[0].animation.tracks.opacity.length, 1);
  api.clearLayerAnimation(target);
  assert.equal(api.useCapture.getState().texts[0].animation, undefined);
  api.useCapture.getState().undo();
  assert.equal(api.useCapture.getState().texts[0].animation.tracks.opacity.length, 1);
  api.useCapture.getState().redo();
  assert.equal(api.useCapture.getState().texts[0].animation, undefined);
  api.useCapture.getState().patch({ recording: true });
  assert.equal(api.setLayerKeyframe(target, "opacity", 2, 0), false);
});

test("native and manual keyframes share the domain rule and AI receipts expose exact changes before one commit", async () => {
  reset();
  const before = snapshot();
  const operations = [
    { kind: "animation.set", sceneId: "main", target: { kind: "text", id: 3 }, tracks: { opacity: [key(2, 0), key(3, 1)] } },
    { kind: "animation.set", sceneId: "main", target: { kind: "clip", id: 1 }, tracks: { scaleX: [key(0, 1), key(10, 2)] } },
    { kind: "animation.set", sceneId: "main", target: { kind: "music" }, tracks: { gain: [key(0, 0), key(2, 1)] } },
  ];
  const batch = await api.prepareNativeBatch(before, operations, options());
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(batch.receipts.map(receipt => receipt.target.kind), ["text", "clip", "scene"]);
  const context = api.nativeProjectContext(batch.project, 0);
  assert.equal(context.scenes[0].texts[0].animation.tracks.opacity[0].time, 0);
  assert.equal(context.scenes[0].clips[0].animation.tracks.scaleX[0].time, 2);
  assert.doesNotThrow(() => parseNativeTurnRequest({ mode: "edit", prompt: "Animate", history: [], observations: [],
    project: context, execution: api.nativeExecutionContext(before, batch.receipts) }));
  assert.equal(api.commitNativeBatch(batch, api.nativeProjectFingerprint(before), "edit"), true);
  assert.equal(api.useCapture.getState().past.length, 1);
  api.useCapture.getState().undo();
  assert.deepEqual(snapshot(), before);
  await assert.rejects(api.prepareNativeBatch(before, [...operations,
    { kind: "animation.remove", sceneId: "main", target: { kind: "text", id: 3 }, property: "opacity", time: 20 },
  ], options()), /inside/);
  assert.deepEqual(snapshot(), before, "Invalid late operation never commits earlier animation");
  const invalid = { ...operations[0], target: { kind: "audio", id: 2 } };
  assert.throws(() => parseNativeOperation(invalid), /not supported/);
});
