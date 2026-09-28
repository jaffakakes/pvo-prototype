import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
    export * from './editor/src/domain/clips/trim.ts';
    export * from './editor/src/domain/text/timing.ts';
    export * from './editor/src/state/editing/timelineEditingCommands.ts';
    export * from './editor/src/state/editing/clipAdjustmentCommands.ts';
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
  adjustSelectedClip,
  setSelectedClipSpeed,
  useCapture,
  initial,
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

test("text drag and numeric timing inputs share bounds without moving the other edge", () => {
  const text = { start: 1, end: 3 };
  assert.deepEqual(dragTextTiming(text, "move", 10, 5), { start: 3, end: 5 });
  assert.deepEqual(dragTextTiming(text, "move", -10, 5), { start: 0, end: 2 });
  assert.deepEqual(
    dragTextTiming(text, "l", 10, 5),
    textTimingAt(text, "start", 11, 5),
  );
  assert.deepEqual(dragTextTiming(text, "r", -10, 5), { end: 1.1 });
  assert.deepEqual(dragTextTiming({ start: 1, end: 9 }, "move", 0, 5), {
    start: 0,
    end: 5,
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
  previewTextTiming(2, { start: 1, end: 3 }, "move", 0.2, 4, true);
  previewTextTiming(2, { start: 1, end: 3 }, "move", 0.5, 4, false);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts[0].start, 1);
  adjustSelectedClip({ zoom: 1.2 });
  adjustSelectedClip({ zoom: 1.6 }, false);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().clips[0].zoom, 1);
});

test("speed adjustment clamps the playhead and can be undone", () => {
  setup();
  setSelectedClipSpeed(4);
  assert.equal(useCapture.getState().t, 2);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().clips[0].speed, 2);
});

test("a continuous speed adjustment records one undo step and synchronizes the scene", () => {
  setup();
  setSelectedClipSpeed(2.5);
  setSelectedClipSpeed(3, false);
  setSelectedClipSpeed(4, false);
  const state = useCapture.getState();
  assert.equal(state.past.length, 1);
  assert.equal(state.scenes[0].clips[0].speed, 4);
  assert.equal(state.t, 2);
  state.undo();
  assert.equal(useCapture.getState().clips[0].speed, 2);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().clips[0].speed, 4);
});
