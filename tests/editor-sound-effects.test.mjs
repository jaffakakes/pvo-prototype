import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
const bundled = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
export * from './editor/src/domain/audio/soundEffects.ts';
export * from './editor/src/domain/audio/editing.ts';
export * from './editor/src/infrastructure/audio/soundEffect.ts';
export * from './editor/src/infrastructure/audio/effectPreview.ts';
export * from './editor/src/features/sound/addSoundEffect.ts';
export * from './editor/src/state/editing/audioCommands.ts';
export { useCapture } from './editor/src/state/captureStore.ts';
export { initial } from './editor/src/state/project/initial.ts';
`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});

const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("effect preview preserves a paused position, restarts after ending and releases its URL exactly once", async () => {
  const previous = globalThis.Audio;
  const revoke = URL.revokeObjectURL;
  const elements = [];
  const released = [];
  globalThis.Audio = class {
    currentTime = 0;
    ended = false;
    paused = true;
    constructor() {
      elements.push(this);
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {
      this.src = "";
    }
    load() {}
  };
  URL.revokeObjectURL = (url) => {
    released.push(url);
    revoke(url);
  };
  const playing = [];
  let failures = 0;
  try {
    const player = api.createEffectPreview(
      new Blob(["effect"]),
      (value) => playing.push(value),
      () => failures++,
    );
    player.play();
    const audio = elements[0];
    const url = audio.src;
    audio.currentTime = 0.4;
    player.pause();
    player.play();
    assert.equal(audio.currentTime, 0.4);
    audio.ended = true;
    audio.onended();
    player.play();
    assert.equal(audio.currentTime, 0);
    player.dispose();
    player.dispose();
    assert.equal(audio.src, "");
    assert.equal(audio.paused, true);
    assert.equal(audio.onended, null);
    assert.deepEqual(released, [url]);
    assert.deepEqual(playing, [true, false, true, false, true]);
    assert.equal(failures, 0);
  } finally {
    globalThis.Audio = previous;
    URL.revokeObjectURL = revoke;
  }
});

test("closing or pausing an effect ignores a late rejected play request", async () => {
  const previous = globalThis.Audio;
  let reject;
  globalThis.Audio = class {
    play() {
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    }
    pause() {}
    removeAttribute() {}
    load() {}
  };
  try {
    for (const action of ["pause", "dispose"]) {
      let failures = 0;
      const player = api.createEffectPreview(
        new Blob(["effect"]),
        () => {},
        () => failures++,
      );
      player.play();
      player[action]();
      reject(new Error("Canceled playback"));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(failures, 0);
      player.dispose();
    }
  } finally {
    globalThis.Audio = previous;
  }
});

test("effect insertion keeps accepted URLs in history and releases blocked insertions", () => {
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const released = [];
  let next = 0;
  URL.createObjectURL = () => `blob:effect-${++next}`;
  URL.revokeObjectURL = (url) => released.push(url);
  try {
    api.useCapture.setState(api.initial());
    api.useCapture.getState().patch({ t: 2.5 });
    assert.equal(api.addSoundEffect("pop"), true);
    assert.equal(api.useCapture.getState().audioClips[0].start, 2.5);
    assert.deepEqual(released, []);
    api.useCapture.getState().patch({ recording: true });
    assert.equal(api.addSoundEffect("ding"), false);
    assert.deepEqual(released, ["blob:effect-2"]);
    assert.equal(api.useCapture.getState().audioClips.length, 1);
    assert.equal(api.addSoundEffect("unknown"), false);
    assert.equal(next, 2);
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
test("each sound effect is bounded non-silent PCM in a portable WAV", async () => {
  for (const effect of api.SOUND_EFFECTS) {
    const samples = api.soundEffectSamples(effect);
    assert.equal(
      samples.length,
      Math.round(effect.seconds * api.EFFECT_SAMPLE_RATE),
    );
    assert(
      samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1),
    );
    assert(samples.some((value) => Math.abs(value) > 0.05));
    assert.equal(samples[0], 0);
    const bytes = await api.soundEffectBlob(effect).arrayBuffer();
    assert.equal(bytes.byteLength, 44 + samples.length * 2);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
    assert.equal(
      new DataView(bytes).getUint32(24, true),
      api.EFFECT_SAMPLE_RATE,
    );
  }
});

test("audio insertion is one undo step, keeps source ownership and rejects stale work", () => {
  api.useCapture.setState(api.initial());
  const original = api.useCapture.getState();
  const source = {
    name: "Pop",
    url: "blob:effect",
    duration: 0.24,
    start: 2.5,
  };
  assert.equal(api.insertAudioClip(source, original), true);
  let state = api.useCapture.getState();
  assert.equal(state.past.length, 1);
  assert.equal(state.audioClips.length, 1);
  assert.equal(state.audioClips[0].start, 2.5);
  assert.equal(state.audioClips[0].out, 0.24);
  assert.equal(state.scenes[0].audioClips[0].url, source.url);
  assert.equal(
    api.insertAudioClip(source, original),
    false,
    "History changes invalidate pending insertions",
  );
  state.undo();
  assert.equal(api.useCapture.getState().audioClips.length, 0);
  api.useCapture.getState().redo();
  assert.equal(api.useCapture.getState().audioClips[0].url, source.url);
  state = api.useCapture.getState();
  assert.equal(api.insertAudioClip({ ...source, duration: NaN }, state), false);
  assert.equal(api.insertAudioClip({ ...source, start: -1 }, state), false);
  state.patch({ localId: "another-project" });
  assert.equal(api.insertAudioClip(source, state), false);
});
