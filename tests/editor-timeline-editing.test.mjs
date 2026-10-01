import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
    export * from './editor/src/domain/clips/trim.ts';
    export * from './editor/src/domain/text/timing.ts';
    export * from './editor/src/state/editing/timelineEditingCommands.ts';
    export * from './editor/src/state/editing/timelineTimingDrag.ts';
    export * from './editor/src/state/editing/clipAdjustmentCommands.ts';
    export * from './editor/src/domain/scenes/duration.ts';
    export { useCapture } from './editor/src/state/captureStore.ts';
    export { initial } from './editor/src/state/project/initial.ts';
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  trimClip,
  dragTextTiming,
  textTimingAt,
  previewClipTrim,
  previewTextTiming,
  finishTextTimingPreview,
  beginTimelineTimingDrag,
  adjustSelectedClip,
  setSelectedClipSpeed,
  useCapture,
  initial,
  sceneDuration,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const clip = {
  id: 1,
  url: null,
  color: "red",
  srcDur: 10,
  in: 1,
  out: 9,
  speed: 2,
  zoom: 1,
  mirror: false,
  width: 9,
  height: 16,
  fit: "contain",
};
function setup() {
  useCapture.setState(initial());
  useCapture
    .getState()
    .patch({
      clips: [{ ...clip }],
      texts: [
        { id: 2, text: "Hello", start: 1, end: 3, color: 0, x: 50, y: 50 },
      ],
      sel: 0,
      t: 3,
      past: [],
      future: [],
    });
}

test("clip trimming preserves source bounds and the speed-adjusted minimum duration", () => {
  assert.equal(trimClip(clip, "l", 1).in, 3);
  assert.equal(trimClip(clip, "l", -100).in, 0);
  assert.equal(trimClip(clip, "l", 100).in, 8.4);
  assert.equal(trimClip(clip, "r", -100).out, 1.6);
  assert.equal(trimClip(clip, "r", 100).out, 10);
  assert.equal(clip.in, 1);
});

test("text timing keeps minimum and zero bounds while allowing a visual tail", () => {
  const text = { start: 1, end: 3 };
  assert.deepEqual(dragTextTiming(text, "move", 10), { start: 11, end: 13 });
  assert.deepEqual(dragTextTiming(text, "move", -10), { start: 0, end: 2 });
  assert.deepEqual(
    dragTextTiming(text, "l", 10),
    textTimingAt(text, "start", 11),
  );
  assert.deepEqual(dragTextTiming(text, "r", -10), { end: 1.1 });
  assert.deepEqual(dragTextTiming(text, "r", 10), { end: 13 });
  assert.deepEqual(dragTextTiming({ start: 1, end: 9 }, "move", 0), {
    start: 1,
    end: 9,
  });
});

test("multiple trim frames produce one undo step and keep the active scene mirror synchronized", () => {
  setup();
  previewClipTrim(clip, 0, "l", 0.5, true, 50);
  previewClipTrim(clip, 0, "l", 1, false, 50);
  const state = useCapture.getState();
  assert.equal(state.past.length, 1);
  assert.equal(state.clips[0].in, 3);
  assert.equal(state.trim.shift, 50);
  assert.equal(state.scenes[0].clips[0].in, 3);
  state.undo();
  assert.equal(useCapture.getState().clips[0].in, 1);
});

test("text movement and continuous crop changes retain grouped undo", () => {
  setup();
  previewTextTiming(2, { start: 1, end: 3 }, "move", 0.2, true);
  previewTextTiming(2, { start: 1, end: 3 }, "move", 0.5, false);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].start, 1);
  adjustSelectedClip({ zoom: 1.2 });
  adjustSelectedClip({ zoom: 1.6 }, false);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().clips[0].zoom, 1);
});

test("mobile text timing keeps the playhead fixed until the gesture ends", () => {
  setup();
  useCapture.getState().updateText(2, { start: 7, end: 20 }, false);
  useCapture.getState().patch({ t: 15, past: [], future: [] });

  previewTextTiming(2, { start: 7, end: 20 }, "r", -11, true);
  assert.equal(useCapture.getState().texts[0].end, 9);
  assert.equal(useCapture.getState().t, 15);
  assert.equal(useCapture.getState().past.length, 1);

  finishTextTimingPreview();
  assert.equal(useCapture.getState().t, 9);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].end, 20);
});

test("speed adjustment retains a playhead inside an explicit text tail", () => {
  setup();
  setSelectedClipSpeed(4);
  assert.equal(useCapture.getState().t, 3);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().clips[0].speed, 2);
});

test("text tail drag preserves the playhead until cancel or commit", () => {
  setup();
  useCapture.getState().updateText(2, { start: 7, end: 20 }, false);
  useCapture.getState().patch({ t: 15, past: [], future: [] });

  const cancelled = beginTimelineTimingDrag({ kind: "text", id: 2, mode: "r" });
  cancelled.update(-11);
  assert.equal(useCapture.getState().texts[0].end, 9);
  assert.equal(useCapture.getState().t, 15, "Preview keeps the magnetic target stationary");
  cancelled.cancel();
  assert.equal(useCapture.getState().texts[0].end, 20);
  assert.equal(useCapture.getState().t, 15);
  assert.equal(useCapture.getState().past.length, 0);

  const committed = beginTimelineTimingDrag({ kind: "text", id: 2, mode: "r" });
  committed.update(-11);
  assert.equal(useCapture.getState().t, 15);
  committed.commit();
  assert.equal(useCapture.getState().texts[0].end, 9);
  assert.equal(useCapture.getState().t, 9);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].end, 20);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().texts[0].end, 9);
  assert.ok(useCapture.getState().t <= sceneDuration(useCapture.getState()));
});

test("updating or deleting the final text tail clamps the active playhead", () => {
  setup();
  useCapture.getState().updateText(2, { start: 7, end: 20 }, false);
  useCapture.getState().patch({ t: 15, playing: true, past: [], future: [] });

  useCapture.getState().updateText(2, { end: 9 });
  assert.equal(useCapture.getState().t, 9);
  assert.equal(useCapture.getState().playing, false);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].end, 20);

  useCapture.getState().patch({ t: 15, playing: true, past: [], future: [] });
  useCapture.getState().deleteText(2);
  assert.equal(useCapture.getState().t, 4);
  assert.equal(useCapture.getState().playing, false);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].end, 20);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().texts.length, 0);
  assert.ok(useCapture.getState().t <= sceneDuration(useCapture.getState()));
});

test("a continuous speed adjustment records one undo step and synchronizes the scene", () => {
  setup();
  setSelectedClipSpeed(2.5);
  setSelectedClipSpeed(3, false);
  setSelectedClipSpeed(4, false);
  const state = useCapture.getState();
  assert.equal(state.past.length, 1);
  assert.equal(state.scenes[0].clips[0].speed, 4);
  assert.equal(state.t, 3);
  state.undo();
  assert.equal(useCapture.getState().clips[0].speed, 2);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().clips[0].speed, 4);
});
