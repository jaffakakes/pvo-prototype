import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { validatePvo, packPvoProject, readPvoProject } from "../packages/pvo-sdk/index.js";
import { applyVideoMotion } from "../player/components/video-motion.js";
import { bindAnimationClock } from "../player/playback/animation-clock.js";
import { drawText } from "../packages/pvo-text-runtime/index.js";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/export/mediaAnimation.ts';
  export * from './editor/src/domain/export/manifest.ts';
  export * from './editor/src/features/export/pvoMediaSource.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const { manifestMediaAnimations, pvoSceneMediaSource, buildPvoManifest } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const track = (from, to, start = 0, end = 2) => [{ time: start, value: from, easing: "linear" }, { time: end, value: to, easing: "linear" }];

test("PVO visual media motion uses original source time once, including exact scene end", () => {
  const video = { style: {} };
  const clips = [{ start: 3, in: 4, out: 8, speed: 2, animation: { tracks: { x: track(0, 20, 4, 8), opacity: track(1, 0, 4, 8) } } }];
  applyVideoMotion(video, clips, 4, 5);
  assert.equal(video.style.opacity, "0.5");
  assert.match(video.style.transform, /translate\(10%, 0%\)/);
  applyVideoMotion(video, clips, 5, 5);
  assert.equal(video.style.opacity, "0");
  applyVideoMotion(video, clips, 2, 5);
  assert.equal(video.style.opacity, "1");
});

test("PVO export retains editable media curves but disables their visual bake", () => {
  const animation = { tracks: { x: track(0, 30), gain: track(1, 0) } };
  const scene = { clips: [{ id: 1, in: 0, out: 2, speed: 1 }, { id: 2, in: 4, out: 8, speed: 2, animation }],
    audioClips: [{ id: 3, start: 1, in: 2, out: 4, speed: 1, animation: { tracks: { gain: track(0, 1) } } }],
    texts: [], components: [], musicAnimation: { tracks: { gain: track(1, 0) } } };
  const metadata = manifestMediaAnimations(scene);
  assert.equal(metadata.clips[0].start, 2);
  assert.deepEqual(metadata.clips[0].animation, animation);
  metadata.clips[0].animation.tracks.x[0].value = 12;
  assert.equal(animation.tracks.x[0].value, 0, "Export metadata owns a deep copy");
  const media = pvoSceneMediaSource({ ratio: "9:16", quality: "720p" }, scene);
  assert.equal(media.includeVideoAnimation, false);
  assert.equal(media.includeText, false);
  assert.equal(media.musicAnimation, scene.musicAnimation, "Audio gain stays available for the exported mix");
});

test("text painter evaluates local clock and multiplies authored opacity around the text pivot", () => {
  const calls = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 10 }) }, {
    get(target, key) { return key in target ? target[key] : (...args) => calls.push([key, ...args]); },
    set(target, key, value) { target[key] = value; calls.push([key, value]); return true; },
  });
  const box = drawText(context, 247, 400, { text: "Move", x: 50, y: 50,
    style: { background: "transparent", rotation: 10, opacity: .8 },
    animation: { tracks: { x: track(0, 20), scaleX: track(1, 2), rotation: track(0, 40), opacity: track(1, 0) } },
  }, 1);
  assert.equal(box.x + box.width / 2, 247 * .6);
  assert.equal(box.style.rotation, 30);
  assert(calls.some(([key, value]) => key === "globalAlpha" && value === .4));
  assert(calls.some(([key, x, y]) => key === "scale" && x === 1.5 && y === 1));
});

test("manifest rejects unsafe keyframes and unsupported audio properties", () => {
  const base = { spec_version: "0.1-prototype", scenes: [{ id: "main", start: 0, end: 5 }], components: [],
    restyle_capture: { scene_layers: { main: { order: ["video"], texts: [] } } } };
  assert.equal(validatePvo(base).valid, true);
  base.restyle_capture.scene_layers.main.musicAnimation = { tracks: { x: track(0, 1) } };
  assert.equal(validatePvo(base).valid, false);
  base.restyle_capture.scene_layers.main.musicAnimation = { tracks: { gain: track(0, 1) } };
  assert.equal(validatePvo(base).valid, true);
  base.restyle_capture.scene_layers.main.texts = [{ animation: { tracks: { opacity: track(1, NaN) } } }];
  assert.equal(validatePvo(base).valid, false);
});

test("player animation clock paints seeks and resumes without duplicate RAFs or leaked listeners", () => {
  const callbacks = new Map(); let serial = 0, paints = 0;
  globalThis.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  const media = new EventTarget(); media.paused = true; media.ended = false;
  const dispose = bindAnimationClock(media, () => paints++);
  try {
    media.paused = false; media.dispatchEvent(new Event("play")); media.dispatchEvent(new Event("play"));
    assert.equal(callbacks.size, 1);
    const [id, frame] = callbacks.entries().next().value; callbacks.delete(id); frame();
    assert.equal(paints, 1); assert.equal(callbacks.size, 1);
    media.dispatchEvent(new Event("seeked")); assert.equal(callbacks.size, 1);
    media.paused = true; media.dispatchEvent(new Event("pause")); assert.equal(callbacks.size, 0);
    const count = paints; dispose(); media.dispatchEvent(new Event("seeked")); assert.equal(paints, count);
  } finally { dispose(); delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});


test("PVO container round-trip preserves visual and audio source-clock curves", async () => {
  const scene = { id: "main", name: "Main", parent: null, muted: false, sound: 1,
    clips: [{ id: 1, in: 4, out: 8, speed: 2, animation: { tracks: { x: track(0, 20, 4, 8), gain: track(1, 0, 4, 8) } } }],
    texts: [{ id: 2, text: "Title", x: 50, y: 50, start: 0, end: 2, color: 0, animation: { tracks: { opacity: track(0, 1) } } }],
    components: [{ id: "note", type: "tooltip", sceneId: "main", at: 0, dur: 2, x: 50, y: 50,
      fields: { text: "Follow" }, animation: { tracks: { y: track(0, 10) } } }],
    audioClips: [{ id: 3, start: 0, in: 1, out: 3, speed: 1, animation: { tracks: { gain: track(0, 1, 1, 3) } } }],
    musicAnimation: { tracks: { gain: track(1, 0) } } };
  const manifest = buildPvoManifest({ scenes: [scene], ratio: "9:16", allowedDomains: [] },
    [{ scene, assetId: "media", name: "scene.webm", type: "video/webm" }]);
  assert.equal(validatePvo(manifest).valid, true);
  const blob = await packPvoProject({ manifest, assets: [{ id: "media", name: "scene.webm", type: "video/webm", blob: new Blob(["fixture"]) }] });
  const decoded = await readPvoProject(blob);
  assert.deepEqual(decoded.manifest.restyle_capture.scene_layers.main.clips[0].animation, scene.clips[0].animation);
  assert.deepEqual(decoded.manifest.restyle_capture.scene_layers.main.texts[0].animation, scene.texts[0].animation);
  assert.deepEqual(decoded.manifest.restyle_capture.scene_layers.main.audioClips[0].animation, scene.audioClips[0].animation);
  assert.deepEqual(decoded.manifest.restyle_capture.scene_layers.main.musicAnimation, scene.musicAnimation);
  assert.deepEqual(decoded.manifest.components[0].restyle_capture.animation, scene.components[0].animation);
});
