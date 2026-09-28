import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
  export * from './editor/src/domain/audio/editing.ts';
  export * from './editor/src/state/editing/audioCommands.ts';
  export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { highestProjectId } from './editor/src/domain/project/highestProjectId.ts';
  export { buildPvoManifest } from './editor/src/domain/export/manifest.ts';
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
const clip = {
  id: 100,
  url: "blob:video",
  srcDur: 12,
  in: 2,
  out: 10,
  speed: 2,
  color: "#000",
  zoom: 1,
  mirror: false,
  width: 320,
  height: 240,
  fit: "contain",
};
function reset() {
  api.useCapture.setState(api.initial());
  api.useCapture
    .getState()
    .patch({ clips: [{ ...clip }, { ...clip, id: 101 }], sel: 1 });
}
const state = () => api.useCapture.getState();

test("audio stays attached until extraction, preserving trim, speed, offset and undo", () => {
  reset();
  assert.equal(state().audioClips.length, 0);
  assert.equal(state().clips[1].audioDetached, undefined);
  api.extractSelectedAudio();
  const audio = state().audioClips[0];
  assert.deepEqual(
    [audio.start, audio.in, audio.out, audio.speed, audio.url],
    [4, 2, 10, 2, "blob:video"],
  );
  assert.equal(state().clips[1].audioDetached, true);
  assert.equal(state().clips[0].audioDetached, undefined);
  assert.equal(state().past.length, 1);
  state().patch({ sel: 1 });
  api.extractSelectedAudio();
  assert.equal(
    state().audioClips.length,
    1,
    "Cannot extract a detached clip twice",
  );
  state().undo();
  assert.equal(state().audioClips.length, 0);
  assert.equal(state().clips[1].audioDetached, undefined);
  state().redo();
  assert.equal(state().audioClips.length, 1);
});

test("audio timing is independent, grouped in history and cancellable", () => {
  reset();
  api.extractSelectedAudio();
  const audio = state().audioClips[0];
  const gesture = api.beginAudioTimingDrag(audio.id, "move");
  gesture.update(1);
  gesture.update(3);
  gesture.commit();
  assert.equal(state().audioClips[0].start, 7);
  assert.equal(
    api.sceneDuration(state()),
    11,
    "Audio may extend past the video",
  );
  assert.equal(state().past.length, 2);
  assert.equal(state().clips[1].in, 2);
  state().undo();
  assert.equal(state().audioClips[0].start, 4);
  const cancelled = api.beginAudioTimingDrag(audio.id, "l");
  cancelled.update(0.5);
  cancelled.cancel();
  assert.deepEqual(state().audioClips[0], audio);
  assert.equal(state().past.length, 1);
});

test("source-aware audio trimming and splitting preserve sound offsets", () => {
  reset();
  api.extractSelectedAudio();
  const audio = state().audioClips[0];
  const trimmed = api.dragAudio(audio, "l", 1);
  assert.deepEqual([trimmed.start, trimmed.in, trimmed.out], [5, 4, 10]);
  const parts = api.splitAudio(trimmed, 6, 999);
  assert.deepEqual(
    parts.map((part) => [part.start, part.in, part.out]),
    [
      [5, 4, 6],
      [6, 6, 10],
    ],
  );
  assert.equal(api.splitAudio(trimmed, 5.01, 999), null);
  assert.equal(api.dragAudio(audio, "r", 100).out, 12);
  assert.equal(api.dragAudio(audio, "move", -100).start, 0);
});

test("saving retains extracted media after the source video and its history are removed", () => {
  reset();
  api.extractSelectedAudio();
  const audio = state().audioClips[0];
  state().patch({ clips: [], past: [], future: [] });
  const draft = api.captureCheckpoint(state());
  assert.deepEqual(api.referencedMedia(draft), ["blob:video"]);
  const stored = api.storeCheckpoint(
    draft,
    new Map([["blob:video", "asset:one"]]),
    123,
  );
  api.validateCheckpoint(stored);
  const restored = api.restoreCheckpoint(
    stored,
    new Map([["asset:one", "blob:restored"]]),
  );
  assert.equal(restored.project.scenes[0].audioClips[0].url, "blob:restored");
  assert.equal(api.highestProjectId([restored.project]), audio.id);
  const scene = restored.project.scenes[0];
  const manifest = api.buildPvoManifest(restored.project, [
    { scene, assetId: "media", name: "video.webm", type: "video/webm" },
  ]);
  assert.equal(manifest.scenes[0].end, 8);
});

test("deleting extracted audio never re-enables its source, and scene changes isolate audio", () => {
  reset();
  api.extractSelectedAudio();
  api.deleteSelectedAudio();
  assert.equal(state().audioClips.length, 0);
  assert.equal(state().clips[1].audioDetached, true);
  state().undo();
  const sceneId = state().createScene();
  assert.equal(state().audioClips.length, 0);
  state().switchScene("main");
  assert.equal(state().audioClips.length, 1);
  state().switchScene(sceneId);
  assert.equal(state().selAudio, null);
});
