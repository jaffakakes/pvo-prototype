import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/store.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export * from './editor/src/state/animation/stageGesture.ts';
  export * from './editor/src/domain/animation/authoring.ts';
  export * from './editor/src/features/animation/stage/motionPath.ts';
  export * from './editor/src/features/animation/stage/trackingBox.ts';
  export { nativeTrackingFingerprint } from './editor/src/domain/animation/trackingEvidence.ts';
  export { objectTrackingTimes } from './packages/pvo-assistant/native/index.js';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const { useCapture, initial, mkClip, beginStageAnimationTransform, readAuthoringValue, motionPath } = api;
const state = () => useCapture.getState();
const snapshot = () => JSON.parse(JSON.stringify(state().scenes));

function fixture(kind = "text") {
  useCapture.setState(initial());
  const clip = mkClip(8, null, 0);
  state().patch({ screen: "editor", clips: [clip], t: 1, sheet: null });
  const id = kind === "text" ? state().addText("Animated title") : state().addComponent("tooltip");
  state().patch({ t: 2, past: [], future: [] });
  return { kind, id };
}

for (const kind of ["text", "component"]) {
  test(`${kind} stage auto-key preserves its base transform and commits one Undo`, () => {
    const target = fixture(kind);
    const before = snapshot();
    const gesture = beginStageAnimationTransform(target, false);
    assert(gesture);
    for (let x = 55; x <= 70; x += 5) assert(gesture.update({ x, y: 65, size: 1 }));
    assert.equal(state().past.length, 0);
    gesture.commit();
    assert.equal(state().past.length, 1);
    const layer = state()[kind === "text" ? "texts" : "components"][0];
    const original = before[0][kind === "text" ? "texts" : "components"][0];
    assert.equal(layer.x, original.x);
    assert.equal(layer.y, original.y);
    assert.deepEqual(Object.keys(layer.animation.tracks).sort(), ["x", "y"]);
    assert.deepEqual(readAuthoringValue(state().scenes[0], target, "position", 2), { x: 70, y: 65 });
    state().undo();
    assert.deepEqual(snapshot(), before);
    state().redo();
    assert.deepEqual(readAuthoringValue(state().scenes[0], target, "position", 2), { x: 70, y: 65 });
  });
}

test("mobile Animate gesture writes the whole transform and cancellation restores it", () => {
  const target = fixture();
  const before = snapshot();
  let gesture = beginStageAnimationTransform(target, true);
  gesture.update({ x: 63, y: 70, size: 1.4 });
  const tracks = state().texts[0].animation.tracks;
  assert.deepEqual(Object.keys(tracks).sort(), ["opacity", "rotation", "scaleX", "scaleY", "x", "y"]);
  assert.equal(tracks.scaleX[0].value, 1.4);
  gesture.cancel();
  assert.deepEqual(snapshot(), before);
  assert.equal(state().past.length, 0);
  gesture = beginStageAnimationTransform(target, true);
  gesture.commit();
  assert.deepEqual(snapshot(), before, "A click without a transform leaves no keys or history");
});

test("video stage authoring uses source time through trim and speed", () => {
  useCapture.setState(initial());
  const clip = { ...mkClip(10, null, 0), in: 4, out: 8, speed: 2 };
  state().patch({ screen: "editor", clips: [clip], t: 1, past: [], future: [] });
  const gesture = beginStageAnimationTransform({ kind: "clip", id: clip.id }, false);
  gesture.update({ x: 80, y: 30, size: 1.5 });
  gesture.commit();
  assert.equal(state().clips[0].animation.tracks.x[0].time, 6);
  assert.equal(state().clips[0].animation.tracks.x[0].value, 30);
  assert.equal(state().clips[0].animation.tracks.scaleX[0].value, 1.5);
  assert.equal(state().past.length, 1);
});

test("path dots reveal easing, hold curves stay still, and layer-local sampling handles offsets", () => {
  const sample = ease => motionPath({ start: 3, end: 5, keyTimes: [3, 5], width: 400, height: 300,
    valueAt: time => ({ x: ease((time - 3) / 2) * 100, y: 50 }) });
  const linear = sample(time => time);
  const eased = sample(time => time * time);
  const jumped = sample(time => time >= 1 ? 1 : 0);
  assert.deepEqual(linear.keys, [{ time: 3, x: 0, y: 150 }, { time: 5, x: 400, y: 150 }]);
  assert.equal(linear.dots.length, 11);
  assert(eased.dots[1].x - eased.dots[0].x < eased.dots.at(-1).x - eased.dots.at(-2).x);
  assert.deepEqual(jumped.points.map(point => point.x), [0, 400]);
  assert.equal(motionPath({ start: 3, end: 5, keyTimes: [3, 5], width: 400, height: 300,
    valueAt: () => ({ x: 50, y: 50 }), pathDots: false }).dots.length, 0);
  assert.equal(motionPath({ start: 3, end: 5, keyTimes: [], width: 400, height: 300,
    valueAt: time => ({ x: time * 10, y: 50 }) }).points.length, 21,
  "A trimmed clip still shows motion when its bracketing source keys are outside the trim");
});

test("tracked stage box shows real bounds and hides lost or stale observations", () => {
  const target = fixture();
  const scene = state().scenes[0];
  const clipId = scene.clips[0].id;
  const times = api.objectTrackingTimes(0, .2);
  const observation = { id: "track", kind: "object_tracking", sceneId: "main", clipId, start: 0, end: .2,
    model: "sam3.1", frameCount: times.length,
    samples: times.map((time, index) => ({ time, visible: index !== 2, x: .3, y: .4, width: .2, height: .3, score: index === 2 ? 0 : .9 })) };
  const tracking = { label: "car", step: 1, observation, requestTarget: { kind: "text", text: "car" },
    sourceFingerprint: api.nativeTrackingFingerprint(state(), "main", clipId), anchor: "center", offsetX: 0, offsetY: 0, generatedTimes: [0, .2] };
  const tracked = { ...scene, texts: [{ ...scene.texts[0], start: 0,
    animation: { tracks: { x: [{ time: 0, value: 0, easing: "linear" }, { time: .2, value: 1, easing: "linear" }] } }, animationTracking: tracking }] };
  const project = { ...state(), scenes: [tracked] };
  const box = api.trackedStageBox(project, "main", target, times[1]);
  assert.deepEqual([box.x, box.y, box.width, box.height], [.3, .4, .2, .3]);
  assert.equal(api.trackedStageBox(project, "main", target, times[2]), null);
  assert.equal(api.trackedStageBox({ ...project, ratio: "16:9" }, "main", target, times[1]), null);
  assert.equal(api.trackedStageBox(project, "main", target, 1), null);
});

test("tracked video box compensates only for the verified camera translation", () => {
  fixture();
  const scene = state().scenes[0];
  const clip = scene.clips[0];
  const target = { kind: "clip", id: clip.id };
  const times = api.objectTrackingTimes(0, .2);
  const animated = { ...clip, animation: { tracks: { x: [{ time: 0, value: 10, easing: "linear" }] } } };
  const project = { ...state(), scenes: [{ ...scene, clips: [animated] }] };
  animated.animationTracking = { label: "car", step: 1, anchor: "center", offsetX: 0, offsetY: 0,
    requestTarget: { kind: "point", x: .3, y: .4 }, generatedTimes: [0], cameraBaseline: { tracks: {} },
    sourceFingerprint: api.nativeTrackingFingerprint(project, "main", clip.id),
    observation: { id: "camera-track", kind: "object_tracking", sceneId: "main", clipId: clip.id,
      start: 0, end: .2, model: "sam3.1", frameCount: times.length,
      samples: times.map(time => ({ time, visible: true, x: .3, y: .4, width: .2, height: .3, score: .9 })) } };
  assert.equal(api.trackedStageBox(project, "main", target, 0).x, .4);
  animated.animation.tracks.x[0].value = 20;
  assert.equal(api.trackedStageBox(project, "main", target, 0), null, "Changed source motion hides stale evidence");
});
