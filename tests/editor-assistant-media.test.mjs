import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/assistant/mediaInspection.ts';
  export * from './editor/src/infrastructure/assistant/media/lifecycle.ts';
  export * from './editor/src/infrastructure/assistant/media/wav.ts';
  export * from './editor/src/infrastructure/assistant/media/audio.ts';
  export * from './editor/src/infrastructure/assistant/media/transcript.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const clip = { id: 1, url: "blob:http://localhost/source", srcDur: 12, in: 2, out: 10, speed: 2,
  color: "#123456", zoom: 1, mirror: false, width: 640, height: 360, fit: "contain" };
const scene = () => ({ id: "main", name: "Main", parent: null, clips: [{ ...clip }, { ...clip, id: 2, in: 0, out: 2, speed: 1 }],
  texts: [{ id: 10, start: 0, end: 8, text: "Title", x: 50, y: 50 }], components: [], muted: false, sound: 0 });
const project = value => ({ scenes: [value], ratio: "16:9" });

test("frame timestamps map trimmed and sped sources, cut boundaries and visual tails", () => {
  const value = scene();
  assert.equal(api.frameAt(value, 1).sourceTime, 4);
  assert.deepEqual(api.frameAt(value, 4), { clip: value.clips[1], sourceTime: 0, sceneTime: 4 });
  assert.deepEqual(api.frameAt(value, 7), { clip: null, sourceTime: null, sceneTime: 7 });
  const request = { kind: "frames", sceneId: "main", start: 0, end: 8, count: 4 };
  assert.equal(api.inspectionScene(project(value), request), value);
  assert.deepEqual(api.inspectionFrames(value, request).map(sample => [sample.sceneTime, sample.clip?.id, sample.sourceTime]),
    [[1, 1, 4], [3, 1, 8], [5, 2, 1], [7, undefined, null]]);
  assert.throws(() => api.inspectionFrames(value, { ...request, count: 9 }), /frames/);
  assert.throws(() => api.inspectionScene(project(value), { ...request, start: -1 }), /range/);
  assert.throws(() => api.inspectionScene(project(value), { ...request, end: 9 }), /range/);
});

test("transcription maps independent audio timing and gain without duplicating detached sound", () => {
  const value = scene();
  value.clips[0].audioDetached = true;
  value.clipGain = 0.5;
  value.audioClips = [{ ...clip, name: "Detached", id: 3, start: 1, muted: false, gain: 0.25 }];
  const request = { kind: "transcript", sceneId: "main", start: 2, end: 6 };
  assert.deepEqual(api.inspectionAudio(value, request).map(sample => [sample.id, sample.offset, sample.sourceStart, sample.duration, sample.speed, sample.gain]),
    [[2, 2, 0, 2, 1, 0.5], [3, 0, 4, 3, 2, 0.25]]);
  value.muted = true;
  assert.deepEqual(api.inspectionAudio(value, request).map(sample => sample.id), [3]);
  value.audioClips[0].muted = true;
  assert.deepEqual(api.inspectionAudio(value, request), []);
  value.audioClips[0].muted = false;
  value.audioClips[0].url = null;
  assert.throws(() => api.inspectionAudio(value, request), /missing/);
  assert.throws(() => api.inspectionAudio(value, { ...request, end: 63 }), /60 seconds/);
});

test("media waits remove listeners on cancellation, decoder error and timeout", async () => {
  class Video extends EventTarget {
    listeners = new Set();
    addEventListener(name, callback, options) { this.listeners.add(callback); super.addEventListener(name, callback, options); }
    removeEventListener(name, callback) { this.listeners.delete(callback); super.removeEventListener(name, callback); }
  }
  const video = new Video();
  const abort = new AbortController();
  const pending = api.waitForMedia(video, "seeked", () => {}, abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(video.listeners.size, 0);
  await assert.rejects(api.waitForMedia(video, "loadeddata", () => video.dispatchEvent(new Event("error"))), /decoded/);
  assert.equal(video.listeners.size, 0);
  await assert.rejects(api.waitForMedia(video, "seeked", () => {}, undefined, 2), /timed out/);
  assert.equal(video.listeners.size, 0);
});

test("temporary media release clears only the decoder and local project URLs are enforced", () => {
  const calls = [];
  api.releaseVideo({ pause: () => calls.push("pause"), removeAttribute: name => calls.push(name), load: () => calls.push("load") });
  assert.deepEqual(calls, ["pause", "src", "load"]);
  globalThis.location = new URL("http://localhost/editor/");
  assert.equal(api.projectMediaUrl(clip.url), clip.url);
  assert.throws(() => api.projectMediaUrl("https://unapproved.example/video.mp4"), /imported/);
  assert.throws(() => api.projectMediaUrl("data:video/mp4;base64,AA"), /imported/);
  assert.throws(() => api.projectMediaUrl("http://user:password@localhost/video.mp4"), /imported/);
  delete globalThis.location;
});

test("PCM WAV is mono 16-bit with clipped amplitudes and exact duration", () => {
  const bytes = api.monoWav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 16000);
  const view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -16384, 0, 16384, 32767]);
});

test("cancellation while audio decoding ignores the late result and schedules no source", async () => {
  globalThis.location = new URL("http://localhost/editor/");
  let decoded;
  let decoding;
  const started = new Promise(resolve => { decoding = resolve; });
  let scheduled = 0;
  globalThis.OfflineAudioContext = class {
    decodeAudioData() { decoding(); return new Promise(resolve => { decoded = resolve; }); }
    createBufferSource() { scheduled++; throw new Error("must not schedule"); }
  };
  const controller = new AbortController();
  try {
    const pending = api.extractAssistantAudio(project(scene()), { kind: "transcript", sceneId: "main", start: 0, end: 2 }, {
      signal: controller.signal, fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    decoded({ duration: 12, numberOfChannels: 1 });
    await Promise.resolve();
    assert.equal(scheduled, 0);
  } finally { delete globalThis.OfflineAudioContext; delete globalThis.location; }
});

test("cancellation during audio rendering disconnects every owned node and releases buffers", async () => {
  globalThis.location = new URL("http://localhost/editor/");
  let rendering;
  const started = new Promise(resolve => { rendering = resolve; });
  const calls = [];
  const sources = [];
  globalThis.OfflineAudioContext = class {
    destination = {};
    async decodeAudioData() { return { duration: 12, numberOfChannels: 1 }; }
    createBufferSource() {
      const source = { buffer: null, playbackRate: {}, connect: target => target,
        start: () => calls.push("start"), stop: () => calls.push("stop"), disconnect: () => calls.push("source disconnect") };
      sources.push(source); return source;
    }
    createGain() { return { gain: {}, connect: () => {}, disconnect: () => calls.push("gain disconnect") }; }
    startRendering() { rendering(); return new Promise(() => {}); }
  };
  const controller = new AbortController();
  try {
    const pending = api.extractAssistantAudio(project(scene()), { kind: "transcript", sceneId: "main", start: 0, end: 6 }, {
      signal: controller.signal, fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(calls.filter(value => value === "stop").length, 2);
    assert.equal(calls.filter(value => value === "source disconnect").length, 2);
    assert.equal(calls.filter(value => value === "gain disconnect").length, 2);
    assert(sources.every(source => source.buffer === null));
  } finally { delete globalThis.OfflineAudioContext; delete globalThis.location; }
});

test("a shorter decoded audio track respects trim and speed while leaving the visual tail silent", async () => {
  globalThis.location = new URL("http://localhost/editor/");
  const scheduled = [];
  let renders = 0;
  globalThis.OfflineAudioContext = class {
    destination = {};
    async decodeAudioData() { return { duration: 5, numberOfChannels: 1 }; }
    createBufferSource() {
      return { buffer: null, playbackRate: {}, connect: target => target,
        start: (...args) => scheduled.push(args), stop() {}, disconnect() {} };
    }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    async startRendering() {
      renders++;
      return { getChannelData: () => new Float32Array(4 * 16000) };
    }
  };
  const request = { kind: "transcript", sceneId: "main", start: 0, end: 4 };
  const options = { fetch: async () => new Response(new Uint8Array([1, 2, 3])) };
  try {
    const wav = await api.extractAssistantAudio(project(scene()), request, options);
    assert.deepEqual(scheduled, [[0, 2, 3]], "Only the remaining three source seconds play at the clip's authored 2x speed");
    assert.equal(wav.byteLength, 4 * 16000 * 2 + 44);
    const tail = await api.extractAssistantAudio(project(scene()), { ...request, start: 2 }, options);
    assert.equal(tail, null);
    assert.equal(scheduled.length, 1, "Do not schedule a source past its decoded audio track");
    assert.equal(renders, 1, "An interval containing only the video tail does not require audio rendering");
  } finally { delete globalThis.OfflineAudioContext; delete globalThis.location; }
});
