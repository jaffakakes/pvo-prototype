import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/infrastructure/audio/musicPlayer.ts';
  export * from './editor/src/infrastructure/audio/audioLayerPlayer.ts';
` },
  bundle: true, write: false, format: "esm", platform: "browser" });
const { createMusicPlayer, createAudioLayerPlayer } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("music preview preserves scene offsets through pause, seek, gain edits and disposal", async () => {
  const instances = [];
  class Context {
    currentTime = 0;
    sampleRate = 8000;
    state = "suspended";
    destination = {};
    sources = [];
    gains = [];
    constructor() { instances.push(this); }
    createBuffer(_channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createGain() {
      const gain = { gain: {}, connect: target => target, disconnect: () => { gain.disconnected = true; } };
      this.gains.push(gain); return gain;
    }
    createBufferSource() {
      const source = { buffer: null, loop: false, connect: target => target,
        start: (when, offset) => { source.offset = offset; },
        stop: () => { source.stopped = true; source.onended?.(); },
        disconnect: () => { source.disconnected = true; } };
      this.sources.push(source); return source;
    }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }
  globalThis.AudioContext = Context;
  const failures = [];
  const player = createMusicPlayer(error => failures.push(error));
  const base = { sceneId: "main", track: 1, volume: 1, time: 5.5, playing: true };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    player.sync(base);
    await flush();
    const context = instances[0];
    assert.equal(context.sources[0].offset, 1.5, "Loop offset follows authored time modulo four seconds");
    player.sync({ ...base, volume: 10 });
    assert.equal(context.gains[0].gain.value, 1, "Malformed persisted gain must not amplify playback");
    player.sync({ ...base, volume: 0.25 });
    assert.equal(context.gains[0].gain.value, 0.25);
    assert.equal(context.sources.length, 1, "Volume edits do not restart the loop");
    player.sync({ ...base, playing: false });
    assert.equal(context.sources[0].stopped, true);
    assert.equal(context.state, "suspended");
    player.sync({ ...base, time: 6 });
    await flush();
    assert.equal(context.sources[1].offset, 2);
    player.sync({ ...base, time: 1 });
    await flush();
    assert.equal(context.sources[1].stopped, true);
    assert.equal(context.sources[2].offset, 1, "Scrubbing while playing resynchronizes the loop");
    player.sync({ ...base, sceneId: "second", time: 0 });
    await flush();
    assert.equal(context.sources[3].offset, 0);
    player.dispose();
    assert.equal(context.state, "closed");
    assert(context.sources.every(source => source.stopped && source.disconnected));
    assert(context.gains.every(gain => gain.disconnected));
    assert.deepEqual(failures, []);
  } finally { player.dispose(); delete globalThis.AudioContext; }
});

test("extracted audio clamps malformed persisted gain before assigning media volume", () => {
  const elements = [];
  globalThis.window = { setTimeout };
  globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
  globalThis.Audio = class extends EventTarget {
    dataset = {};
    readyState = 2;
    currentTime = 0;
    paused = true;
    constructor() { super(); elements.push(this); }
    set volume(value) {
      assert(Number.isFinite(value) && value >= 0 && value <= 1, "Native media.volume rejects invalid values");
      this.appliedVolume = value;
    }
    get volume() { return this.appliedVolume; }
    getAttribute(name) { return name === "src" ? this.src : null; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
    load() {}
    pause() { this.paused = true; }
  };
  const player = createAudioLayerPlayer(error => { throw error; });
  try {
    const clip = { id: 1, name: "Audio", url: "blob:source", srcDur: 3, in: 0, out: 3, speed: 1, start: 0, muted: false };
    for (const [gain, expected] of [[2, 1], [-1, 0], [NaN, 1], [Infinity, 1]]) {
      player.sync([{ ...clip, gain }], 0, false);
      assert.equal(elements[0].volume, expected);
    }
    const animated = { ...clip, in: 1, out: 3, speed: 2, start: 5, gain: .8,
      animation: { tracks: { gain: [
        { time: 1, value: 0, easing: "linear" }, { time: 3, value: 1, easing: "linear" },
      ] } } };
    player.sync([animated], 5.5, false);
    assert.equal(elements[0].volume, .4, "Source-clock gain follows trimmed audio at double speed");
    player.sync([animated], 6, false);
    assert.equal(elements[0].volume, .8, "A paused exact-end seek retains the final gain");
    player.sync([animated], 5, false);
    assert.equal(elements[0].volume, 0, "Backward seeking re-evaluates the curve");
  } finally {
    player.dispose();
    delete globalThis.Audio; delete globalThis.HTMLMediaElement; delete globalThis.window;
  }
});

test("closing preview while resume is pending cannot start a late music source", async () => {
  let resumed;
  let closed = false;
  let created = false;
  globalThis.AudioContext = class {
    destination = {};
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    resume() { return new Promise(resolve => { resumed = resolve; }); }
    async close() { closed = true; }
    createBufferSource() { created = true; throw new Error("Unexpected late source"); }
  };
  const player = createMusicPlayer(() => {});
  try {
    player.sync({ sceneId: "main", track: 1, volume: 1, time: 0, playing: true });
    player.dispose();
    resumed();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created, false);
    assert.equal(closed, true);
  } finally { delete globalThis.AudioContext; }
});
