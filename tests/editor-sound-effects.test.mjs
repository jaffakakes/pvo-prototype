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
