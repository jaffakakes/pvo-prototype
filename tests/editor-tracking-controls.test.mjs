import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/animation/trackingRange.ts';
  export * from './editor/src/state/editing/trackingCommands.ts';
  export * from './editor/src/domain/assistant/native/context.ts';
  export * from './editor/src/state/project/history.ts';
  export * from './editor/src/state/project/initial.ts';
  export * from './editor/src/state/captureStore.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const { defaultTrackingRange, trackingRangeBounds, validateTrackingRange, commitTrackedAnimation,
  nativeProjectFingerprint, projectSnapshot, initial, useCapture } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const scene = () => ({ id: "main", name: "Main", parent: null, muted: false, sound: 0,
  clips: [{ id: 1, url: "blob:test", color: "#000", srcDur: 30, in: 4, out: 24, speed: 2, fit: "contain", zoom: 1, mirror: false, width: 640, height: 360 },
    { id: 2, url: "blob:second", color: "#000", srcDur: 8, in: 0, out: 8, speed: 1, fit: "cover", zoom: 1, mirror: false, width: 640, height: 360 }],
  texts: [{ id: 7, text: "Follow", x: 50, y: 50, start: 2, end: 14, color: 0 }], components: [], audioClips: [] });
const target = { kind: "text", id: 7 };

test("manual tracking range intersects one source clip and target layer without crossing cuts", () => {
  const value = scene();
  assert.deepEqual(defaultTrackingRange(value, target, 5), { clipId: 1, start: 5, end: 10 });
  assert.deepEqual(defaultTrackingRange(value, target, 11), { clipId: 2, start: 11, end: 14 });
  assert.equal(defaultTrackingRange(value, { kind: "music" }, 0), null);
  assert.equal(trackingRangeBounds(value, { kind: "clip", id: 2 }, 1), null);
  assert.throws(() => validateTrackingRange(value, target, { clipId: 1, start: 5, end: 11 }), /inside one video/);
  assert.throws(() => validateTrackingRange(value, target, { clipId: 1, start: 1, end: 3 }), /inside one video/);
});

test("manual tracking commits one history step, rejects stale projects and retains shared Undo", () => {
  useCapture.setState(initial());
  useCapture.getState().patch({ screen: "editor", scenes: [scene()], currentSceneId: "main", t: 2, selText: 7, past: [], future: [] });
  const snapshot = projectSnapshot(useCapture.getState());
  const fingerprint = nativeProjectFingerprint(snapshot);
  const observation = { kind: "object_tracking", id: "measured", sceneId: "main", clipId: 1, start: 2, end: 4,
    model: "sam3.1", frameCount: 2, samples: [
      { time: 2, visible: true, x: .3, y: .5, width: .2, height: .2, score: .9 },
      { time: 4, visible: true, x: .5, y: .5, width: .2, height: .2, score: .9 },
    ] };
  const request = { requestTarget: { kind: "text", text: "car" } };
  assert.equal(commitTrackedAnimation(target, observation, fingerprint, { anchor: "top", offsetX: 0, offsetY: -5 }, request), true);
  assert.equal(useCapture.getState().past.length, 1);
  const animation = useCapture.getState().texts[0].animation;
  assert.equal(animation.tracks.x.find(key => key.time === 0).value, 0, "Tracking retains the existing horizontal separation");
  assert.equal(animation.tracks.y.find(key => key.time === 0).value, -5, "Requested offset adjusts the retained separation");
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].animation, undefined);
  useCapture.getState().patch({ texts: [{ ...useCapture.getState().texts[0], text: "Edited meanwhile" }] });
  assert.throws(() => commitTrackedAnimation(target, observation, fingerprint, { anchor: "center", offsetX: 0, offsetY: 0 }, request), /project changed/);
  assert.equal(useCapture.getState().texts[0].animation, undefined);
});
