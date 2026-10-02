import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/animation/authoring.ts';
  export * from './editor/src/domain/animation/authoringEdits.ts';
  export * from './editor/src/domain/animation/targets.ts';
  export * from './editor/src/state/animation/commands.ts';
  export * from './editor/src/state/animation/selection.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { useAssistant } from './editor/src/state/assistant/assistantStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const key = (time, value, easing = "linear") => ({ time, value, easing });
const target = { kind: "text", id: 3 };
function fixture() {
  return { id: "main", name: "Main", parent: null, muted: false, sound: 1,
    clips: [{ id: 1, url: null, color: "#000", srcDur: 30, in: 2, out: 22, speed: 2,
      zoom: 1, mirror: false, width: 320, height: 240, fit: "contain" }],
    audioClips: [{ id: 2, name: "Audio", url: null, srcDur: 30, in: 4, out: 20, speed: 2, start: 1.03, muted: false }],
    texts: [{ id: 3, text: "Title", color: 0, start: 2.03, end: 8.03, x: 40, y: 30 }],
    components: [{ id: "note", type: "tooltip", sceneId: "main", at: 3, dur: 5, x: 50, y: 50, fields: { text: "Note" } }],
  };
}
const state = () => api.useCapture.getState();
const scene = () => state().scenes[0];
const selection = () => api.useAnimationSelection.getState().selection;
function reset(value = fixture()) {
  api.useCapture.setState(api.initial());
  api.useAssistant.setState({ phase: "idle" });
  api.useAnimationSelection.getState().clear();
  state().patch({ scenes: [value], currentSceneId: "main", screen: "editor", selText: 3 });
}

test("authoring groups project absolute paired position and percentages without rewriting asymmetric curves", () => {
  const original = fixture();
  original.texts[0].animation = { tracks: { x: [key(0, 10), key(2, 20)], y: [key(1, -5)],
    scaleX: [key(0, 1.5)], scaleY: [key(0, .7)], opacity: [key(0, .62)] } };
  assert.deepEqual(api.getAuthoringKeys(original, target, "position").map(point => point.time), [2.03, 3.03, 4.029999999999999]);
  assert.deepEqual(api.readAuthoringValue(original, target, "position", 3.03), { x: 55, y: 25 });
  assert.equal(api.readAuthoringValue(original, target, "opacity", 3), 62);
  const saved = JSON.stringify(original);
  const result = api.changeAuthoringAnimation(original, target, { kind: "add", time: 3.03, options: { wholeTransform: true } });
  assert.equal(result.scene.texts[0].animation.tracks.scaleX[1].value, 1.5);
  assert.equal(result.scene.texts[0].animation.tracks.scaleY[1].value, .7, "Adding a whole transform preserves existing independent axes");
  assert.equal(JSON.stringify(original), saved);
});

test("scene-time authoring snaps on the layer-local grid then converts to source clocks", () => {
  reset();
  api.setAuthoringValue(target, "position", 2.164, { x: 60, y: 10 });
  assert.deepEqual(scene().texts[0].animation.tracks.x, [key(.1499999999999999, 20)]);
  assert.equal(selection().time, 2.1799999999999997);
  const audio = { kind: "audio", id: 2 };
  api.setAuthoringValue(audio, "volume", 1.164, 25);
  assert.ok(Math.abs(scene().audioClips[0].animation.tracks.gain[0].time - 4.3) < 1e-10);
  assert.equal(scene().audioClips[0].animation.tracks.gain[0].value, .25);
  assert.equal(api.snapAuthoringTime(2.164, 2.03, 8.03), 2.1799999999999997);
});

test("whole-transform add, edit, ease and removal are atomic, with clip volume retained separately", () => {
  reset();
  state().patch({ playing: true });
  api.setAuthoringValue(target, "position", 3.03, { x: 64, y: 20 }, { wholeTransform: true });
  assert.deepEqual(Object.keys(scene().texts[0].animation.tracks), ["x", "y", "scaleX", "scaleY", "rotation", "opacity"]);
  assert.equal(state().past.length, 1);
  assert.equal(state().playing, false);
  api.setAuthoringEasing(target, "position", 3.03, "hold", { wholeTransform: true });
  assert.ok(Object.values(scene().texts[0].animation.tracks).every(frames => frames[0].easing === "hold"));
  api.removeAuthoringKey(target, 3.03, { wholeTransform: true });
  assert.equal(scene().texts[0].animation, undefined);
  state().undo();
  assert.equal(Object.keys(scene().texts[0].animation.tracks).length, 6);
  const clip = { kind: "clip", id: 1 };
  api.setAuthoringValue(clip, "volume", 1, 30);
  api.addAuthoringKey(clip, 2, { wholeTransform: true });
  assert.equal(scene().clips[0].animation.tracks.gain.length, 1);
  assert.equal(scene().clips[0].animation.tracks.gain[0].value, .3);
});

test("key moves clamp between neighbours in timeline seconds and move the entire paired key together", () => {
  reset();
  for (const time of [2.03, 3.03, 4.03]) api.addAuthoringKey(target, time, { wholeTransform: true });
  const before = state().past.length;
  api.moveAuthoringKey(target, "position", 3.03, 8, { wholeTransform: true });
  assert.ok(Math.abs(selection().time - 3.93) < 1e-9);
  for (const frames of Object.values(scene().texts[0].animation.tracks)) assert.ok(Math.abs(frames[1].time - 1.9) < 1e-9);
  assert.equal(state().past.length, before + 1);
  api.addAuthoringKey(target, 4.08, { group: "position" });
  assert.ok(api.getAuthoringKeys(scene(), target, "position").some(key => Math.abs(key.time - 4.08) < 1e-9),
    "Adding on the .05 grid is allowed; the .1 separation applies only while moving");
  api.addAuthoringKey(target, 4.13, { group: "position" });
  const count = state().past.length;
  api.moveAuthoringKey(target, "position", 4.08, 5);
  assert.equal(state().past.length, count, "A crowded key with no valid move span stays in place");
});

test("gestures accumulate paired position and scale previews into one undo, then cancel or return to origin without extra history", () => {
  reset();
  api.addAuthoringKey(target, 3.03, { wholeTransform: true });
  const original = JSON.stringify(scene());
  const count = state().past.length;
  const gesture = api.beginAnimationGesture(target);
  assert.equal(gesture.setValue("position", 3.03, { x: 70, y: 20 }, true), true);
  assert.equal(gesture.setValue("scale", 3.03, 1.5, true), true);
  assert.equal(state().past.length, count);
  assert.deepEqual(api.readAuthoringValue(scene(), target, "position", 3.03), { x: 70, y: 20 });
  gesture.commit(); gesture.commit();
  assert.equal(state().past.length, count + 1);
  state().undo(); assert.equal(JSON.stringify(scene()), original);
  const cancelled = api.beginAnimationGesture(target);
  cancelled.setValue("opacity", 3.03, 10, true);
  cancelled.cancel();
  assert.equal(JSON.stringify(scene()), original);
  assert.equal(state().past.length, count);
  const noop = api.beginAnimationGesture(target);
  noop.setValue("opacity", 3.03, 10, true);
  noop.setValue("opacity", 3.03, 100, true);
  noop.commit();
  assert.equal(state().past.length, count, "Returning an existing key to its original value leaves Undo unchanged");
});

test("drag previews resolve original key time repeatedly and preserve newer edits on stale cancellation", () => {
  reset();
  for (const time of [2.03, 3.03, 6.03]) api.addAuthoringKey(target, time, { group: "position" });
  const gesture = api.beginAnimationGesture(target);
  gesture.moveKey("position", 3.03, 4.03);
  gesture.moveKey("position", 3.03, 5.03);
  assert.ok(api.getAuthoringKeys(scene(), target, "position").some(key => Math.abs(key.time - 5.03) < 1e-9));
  gesture.cancel();
  assert.ok(api.getAuthoringKeys(scene(), target, "position").some(key => Math.abs(key.time - 3.03) < 1e-9));
  const stale = api.beginAnimationGesture(target);
  stale.setValue("position", 3.03, { x: 70, y: 50 });
  api.setAuthoringValue(target, "position", 3.03, { x: 80, y: 50 });
  assert.equal(stale.setValue("position", 3.03, { x: 90, y: 50 }), false);
  stale.cancel();
  assert.equal(api.readAuthoringValue(scene(), target, "position", 3.03).x, 80);
});

test("selection seeks without history, clears on layer changes/Undo, and keyboard Delete consumes only a valid selected key", () => {
  reset();
  api.addAuthoringKey(target, 3.03, { group: "position" });
  const count = state().past.length;
  api.useAnimationSelection.getState().select({ sceneId: "main", target, group: "position", time: 3.03 });
  assert.equal(state().past.length, count);
  assert.equal(state().t, 3.03);
  assert.equal(api.deleteSelectedAuthoringKey(), true);
  assert.equal(scene().texts.length, 1);
  assert.equal(api.deleteSelectedAuthoringKey(), false);
  state().undo(); assert.equal(selection(), null);
  api.useAnimationSelection.getState().select({ sceneId: "main", target, group: "position", time: 3.03 });
  state().patch({ sel: 0 }); assert.equal(selection(), null);
  api.useAssistant.setState({ phase: "working" });
  assert.equal(api.addAuthoringKey(target, 4.03), false);
  assert.equal(api.beginAnimationGesture(target), null);
});

test("music is an authoring target only after explicitly opening its controls", () => {
  reset();
  state().patch({ sel: -1, selText: null, selComp: null, selAudio: null, sheet: null });
  assert.equal(api.selectedAuthoringTarget(state()), null);
  assert.equal(api.addSelectedAuthoringKey(), false);
  assert.equal(state().past.length, 0);
  state().patch({ sheet: "sound" });
  assert.deepEqual(api.selectedAuthoringTarget(state()), { kind: "music" });
  state().patch({ sheet: "animation" });
  assert.deepEqual(api.selectedAuthoringTarget(state()), { kind: "music" });
});

test("audio fades preserve outside keys, use source time and one Undo, including short media", () => {
  const original = fixture();
  original.audioClips[0].animation = { tracks: { gain: [key(4, .5), key(10, .4), key(20, .3)] } };
  reset(original);
  const audio = { kind: "audio", id: 2 };
  assert.equal(api.fadeAuthoringVolume(audio, "in"), true);
  const frames = scene().audioClips[0].animation.tracks.gain;
  assert.equal(frames[0].value, 0); assert.equal(frames[0].easing, "ease-out");
  assert.ok(Math.abs(frames[1].time - 5.6) < 1e-10);
  assert.equal(frames[1].value, 1);
  assert.deepEqual(frames.slice(2), [key(10, .4), key(20, .3)]);
  assert.equal(state().past.length, 1);
  assert.equal(api.fadeAuthoringVolume(audio, "in"), false);
  state().undo(); assert.deepEqual(scene().audioClips[0].animation, original.audioClips[0].animation);
  const short = fixture(); short.audioClips[0].out = 4.1;
  const faded = api.changeAuthoringFade(short, audio, "out");
  assert.deepEqual(faded.audioClips[0].animation.tracks.gain.map(key => key.value), [1, 0]);
});
