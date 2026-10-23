import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
  export * from './editor/src/domain/layers/order.ts';
  export * from './editor/src/domain/layers/sceneLayers.ts';
  export * from './editor/src/domain/audio/music.ts';
  export * from './editor/src/domain/animation/targets.ts';
  export * from './editor/src/domain/scenes/duration.ts';
  export * from './editor/src/domain/scenes/duplicate.ts';
  export * from './editor/src/features/desktop-editor/timeline/layerRows.ts';
  export * from './editor/src/state/editing/layerTimingCommands.ts';
  export * from './editor/src/state/editing/layerSelection.ts';
  export * from './editor/src/state/editing/layerReorderDrag.ts';
  export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { mkClip } from './editor/src/state/editing/clipFactory.ts';
`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const state = () => api.useCapture.getState();
const animation = {
  tracks: {
    gain: [
      { time: 0.5, value: 0, easing: "linear" },
      { time: 2.5, value: 1, easing: "linear" },
    ],
  },
};
function setup() {
  api.useCapture.setState(api.initial());
  state().patch({
    screen: "editor",
    localId: "layers-a",
    clips: [api.mkClip(8, null, 0)],
    texts: [
      { id: 10, text: "Title", start: 0, end: 2, color: 0, x: 50, y: 50 },
    ],
    audioClips: [
      {
        id: 20,
        name: "Effect",
        url: null,
        srcDur: 5,
        in: 1,
        out: 3,
        start: 2,
        speed: 1,
        muted: false,
        animation: structuredClone(animation),
      },
    ],
    music: {
      track: 1,
      start: 1,
      duration: 4,
      offset: 0.5,
      gain: 0.8,
      animation: structuredClone(animation),
    },
    layers: ["music", "audio:20", "video", "text:10"],
  });
}

test("all timeline items resolve to typed layers and use one selection contract", () => {
  setup();
  assert.deepEqual(
    api.sceneLayers(state()).map(({ id, type }) => ({ id, type })),
    [
      { id: "music", type: "music" },
      { id: "audio:20", type: "audio" },
      { id: "video", type: "video" },
      { id: "text:10", type: "text" },
    ],
  );
  for (const id of state().layers) {
    api.selectTimelineLayer(id);
    assert.equal(api.selectedLayerId(state()), id);
    assert.equal(
      [
        state().sel >= 0,
        state().selText != null,
        state().selAudio != null,
        state().selMusic,
      ].filter(Boolean).length,
      1,
    );
  }
});

test("music and sound reorder with visual layers without changing compositing", () => {
  setup();
  const visual = api.visualLayerOrder(state());
  const original = [...state().layers];
  const drag = api.beginLayerReorderDrag("audio:20");
  const order = ["video", "music", "text:10", "audio:20"];
  assert.equal(drag.update(order), true);
  assert.equal(drag.commit(), true);
  assert.equal(state().past.length, 1);
  assert.deepEqual(api.visualLayerOrder(state()), visual);
  state().undo();
  assert.deepEqual(state().layers, original);
  state().redo();
  assert.deepEqual(state().layers, order);
  const rows = api
    .desktopLayerLayout(state(), 50)
    .rows.filter((row) => row.layerIds.length);
  assert.deepEqual(
    rows.flatMap((row) => row.layerIds),
    order.slice().reverse(),
  );
});

test("one shared timing command moves audio and music, retaining source clocks and one Undo", () => {
  for (const id of ["audio:20", "music"]) {
    setup();
    const before = structuredClone(
      id === "music" ? state().music : state().audioClips[0],
    );
    const drag = api.beginLayerTimingDrag(id, "move");
    assert.equal(drag.update(1), true);
    assert.equal(drag.update(3), true);
    assert.equal(state().past.length, 0);
    drag.commit();
    assert.equal(state().past.length, 1);
    const after = id === "music" ? state().music : state().audioClips[0];
    assert.equal(after.start, before.start + 3);
    assert.deepEqual(after.animation, before.animation);
    if (id === "music") assert.equal(after.offset, before.offset);
    else assert.equal(after.in, before.in);
    state().undo();
    assert.deepEqual(
      id === "music" ? state().music : state().audioClips[0],
      before,
    );
  }
});

test("moving and trimming music uses its own source clock and extends the authored scene", () => {
  setup();
  const target = { kind: "music" };
  const before = api.getAnimationTarget(state().scenes[0], target);
  assert.equal(api.animationTime(before, 2), 1.5);
  const move = api.beginLayerTimingDrag("music", "move");
  move.update(8);
  move.commit();
  assert.equal(api.sceneDuration(state()), 13);
  const after = api.getAnimationTarget(state().scenes[0], target);
  assert.equal(api.animationTime(after, 10), 1.5);
  const trim = api.beginLayerTimingDrag("music", "l");
  trim.update(1);
  trim.commit();
  assert.deepEqual(
    [state().music.start, state().music.duration, state().music.offset],
    [10, 3, 1.5],
  );
  assert.equal(api.musicPlaying(state().music, 9.9), false);
  assert.equal(api.musicPlaying(state().music, 10), true);
  assert.equal(api.musicPlaying(state().music, 13), false);
});

test("cancelled gestures restore order/timing and do not overwrite a newer project", () => {
  setup();
  const original = structuredClone(state().music);
  const timing = api.beginLayerTimingDrag("music", "move");
  timing.update(2);
  timing.cancel();
  assert.deepEqual(state().music, original);
  assert.equal(state().past.length, 0);
  const reorder = api.beginLayerReorderDrag("music");
  reorder.update(["audio:20", "video", "text:10", "music"]);
  reorder.cancel();
  assert.deepEqual(state().layers, ["music", "audio:20", "video", "text:10"]);
  const stale = api.beginLayerTimingDrag("music", "move");
  stale.update(2);
  state().patch({
    localId: "replacement-project",
    music: { ...original, start: 6 },
  });
  assert.equal(stale.update(4), false);
  stale.cancel();
  assert.equal(state().music.start, 6);
});

test("typed layer order and music clocks survive checkpoints, history and scene copies", () => {
  setup();
  state().reorderLayer("music", "up");
  const checkpoint = api.storeCheckpoint(
    api.captureCheckpoint(state()),
    new Map(),
    123,
  );
  const restored = api.restoreCheckpoint(checkpoint, new Map());
  const scene = restored.project.scenes[0];
  assert.deepEqual(scene.layers, state().layers);
  assert.deepEqual(scene.music, state().music);
  assert.notEqual(scene.music.animation, state().music.animation);
  let next = 100;
  const copy = api.duplicateSceneData(scene, [scene], "copy", () => next++);
  assert(copy.layers.includes(`audio:${copy.audioClips[0].id}`));
  assert(!copy.layers.includes("audio:20"));
  assert.deepEqual(copy.music, scene.music);
  assert.notEqual(copy.music, scene.music);
});

test("invalid music ranges are rejected before playback or restoration", () => {
  setup();
  for (const patch of [
    { start: -1 },
    { duration: 0 },
    { offset: NaN },
    { gain: 2 },
    { track: 99 },
  ])
    assert.throws(
      () => api.assertMusicLayer({ ...state().music, ...patch }),
      /Music needs/,
    );
});
