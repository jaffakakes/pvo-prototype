import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
      export * from './editor/src/domain/clips/selectionEditing.ts';
      export { trimClipHandle } from './editor/src/domain/clips/trim.ts';
      export * from './editor/src/state/editing/selectionCommands.ts';
      export * from './editor/src/state/editing/timelineTimingDrag.ts';
      export * from './editor/src/features/desktop-editor/timeline/geometry.ts';
      export * from './editor/src/features/desktop-editor/timeline/layerRows.ts';
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
  useCapture,
  initial,
  selectedSplitTime,
  trimSelectedAtPlayhead,
  splitSelectedClip,
  duplicateTimelineSelection,
  deleteTimelineSelection,
  beginTimelineTimingDrag,
  trimClipHandle,
  snappedTime,
  timelineSnapPoints,
  desktopLayerRows,
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
  useCapture.getState().patch({
    clips: [{ ...clip }, { ...clip, id: 2 }],
    texts: [{ id: 3, text: "Hello", start: 1, end: 3, color: 0, x: 50, y: 50 }],
    screen: "editor",
    sel: 0,
    selText: null,
    selComp: null,
    t: 3,
    past: [],
    future: [],
  });
}

test("desktop visual layers render front-to-back without mutating a dense mixed stack", () => {
  const source = {
    texts: [
      { id: 11, text: "First", start: 1, end: 4 },
      { id: 12, text: "Second", start: 1, end: 4 },
    ],
    components: [
      { id: "card", at: 1, dur: 3 },
      { id: "choice", at: 1, dur: 3 },
    ],
    layers: [
      "video",
      "text:11",
      "component:card",
      "text:12",
      "component:choice",
    ],
  };
  const before = structuredClone(source);

  assert.deepEqual(desktopLayerRows(source), [
    {
      id: "component:choice",
      kind: "component",
      layerId: "component:choice",
    },
    { id: "text:12", kind: "text", layerId: "text:12" },
    {
      id: "component:card",
      kind: "component",
      layerId: "component:card",
    },
    { id: "text:11", kind: "text", layerId: "text:11" },
    { id: "video", kind: "video", layerId: "video" },
  ]);
  assert.deepEqual(source, before, "row projection must not reorder project data");
});

test("desktop layer rows retain add targets for each empty visual layer type", () => {
  assert.deepEqual(
    desktopLayerRows({ texts: [], components: [], layers: ["video"] }),
    [
      { id: "add:components", kind: "empty-components", layerId: null },
      { id: "add:text", kind: "empty-text", layerId: null },
      { id: "video", kind: "video", layerId: "video" },
    ],
  );

  assert.deepEqual(
    desktopLayerRows({
      texts: [{ id: 11 }],
      components: [],
      layers: ["video", "text:11"],
    }),
    [
      { id: "add:components", kind: "empty-components", layerId: null },
      { id: "text:11", kind: "text", layerId: "text:11" },
      { id: "video", kind: "video", layerId: "video" },
    ],
  );

  assert.deepEqual(
    desktopLayerRows({
      texts: [],
      components: [{ id: "card" }],
      layers: ["video", "component:card"],
    }),
    [
      { id: "add:text", kind: "empty-text", layerId: null },
      {
        id: "component:card",
        kind: "component",
        layerId: "component:card",
      },
      { id: "video", kind: "video", layerId: "video" },
    ],
  );
});

test("selected split stays inside the selected clip and preserves speed", () => {
  setup();
  const state = useCapture.getState();
  assert.equal(selectedSplitTime(state.clips, 0, 7), 2);
  state.patch({ t: 7 });
  splitSelectedClip();
  assert.equal(useCapture.getState().clips.length, 3);
  assert.equal(useCapture.getState().clips[0].out, 5);
  assert.equal(useCapture.getState().clips[1].in, 5);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().clips.length, 2);
});

test("trimming at the playhead respects selected clip bounds and source speed", () => {
  setup();
  const clips = useCapture.getState().clips;
  assert.equal(trimSelectedAtPlayhead(clips, 1, 2, "l"), null);
  const left = trimSelectedAtPlayhead(clips, 1, 6, "l");
  assert.equal(left.clips[1].in, 5);
  assert.equal(left.time, 4);
  assert.equal(trimSelectedAtPlayhead(clips, 1, 6, "r").clips[1].out, 5);
});

test("duplicating text places the copy after the original with one undo step", () => {
  setup();
  useCapture.getState().patch({ sel: -1, selText: 3 });
  duplicateTimelineSelection();
  const state = useCapture.getState();
  assert.equal(state.texts.length, 2);
  assert.deepEqual([state.texts[1].start, state.texts[1].end], [3, 5]);
  assert.equal(state.past.length, 1);
  state.undo();
  assert.equal(useCapture.getState().texts.length, 1);
});

test("deleting the final desktop clip leaves the editor open and remains undoable", () => {
  setup();
  useCapture.getState().patch({ clips: [{ ...clip }] });
  deleteTimelineSelection();
  assert.equal(useCapture.getState().clips.length, 0);
  assert.equal(useCapture.getState().screen, "editor");
  useCapture.getState().undo();
  assert.equal(useCapture.getState().clips.length, 1);
});

test("clip and text timing gestures commit once and cancel without history", () => {
  setup();
  const drag = beginTimelineTimingDrag({ kind: "clip", id: 1, mode: "r" });
  drag.update(-1.06);
  drag.update(-2);
  assert.equal(useCapture.getState().past.length, 0);
  drag.commit();
  assert.equal(useCapture.getState().past.length, 1);
  assert.equal(useCapture.getState().clips[0].out, 5);
  useCapture.getState().undo();
  const textDrag = beginTimelineTimingDrag({
    kind: "text",
    id: 3,
    mode: "move",
  });
  textDrag.update(2);
  assert.equal(useCapture.getState().texts[0].start, 3);
  textDrag.cancel();
  assert.equal(useCapture.getState().texts[0].start, 1);
  assert.equal(useCapture.getState().past.length, 0);
});

test("clip handles enforce half-second minimum and snapping uses timeline pixels", () => {
  setup();
  const drag = beginTimelineTimingDrag({ kind: "clip", id: 1, mode: "l" });
  drag.update(100);
  assert.equal(useCapture.getState().clips[0].in, 8);
  drag.cancel();
  const state = useCapture.getState();
  const points = timelineSnapPoints(state.clips, [], state.texts);
  assert.equal(snappedTime(1.15, points, 40, 8, true), 1);
  assert.equal(snappedTime(1.15, points, 120, 8, true), 1.15);
  assert.equal(snappedTime(1.15, points, 40, 8, false), 1.15);
});

test("an exact clip-handle snap bypasses normal tenth-second rounding", () => {
  const snapped = trimClipHandle(clip, "r", -1.97, true);
  assert.ok(Math.abs(snapped.out - 5.06) < Number.EPSILON * 8);
  assert.equal(trimClipHandle(clip, "r", -1.97).out, 5);
});

test("video trimming keeps its playhead target stationary until release", () => {
  setup();
  useCapture.getState().patch({ t: 7, playing: true });
  const drag = beginTimelineTimingDrag({ kind: "clip", id: 2, mode: "r" });
  assert.equal(useCapture.getState().playing, false);
  drag.update(-3, true);
  assert.equal(useCapture.getState().t, 7);
  drag.commit();
  assert.equal(useCapture.getState().t, 5);
});

test("a cancelled timing drag preserves pending redo and later edits", () => {
  setup();
  duplicateTimelineSelection();
  useCapture.getState().undo();
  const redo = useCapture.getState().future;
  const drag = beginTimelineTimingDrag({ kind: "clip", id: 1, mode: "r" });
  drag.update(-1);
  drag.cancel();
  assert.equal(useCapture.getState().clips[0].out, 9);
  assert.equal(useCapture.getState().future, redo);
  const stale = beginTimelineTimingDrag({ kind: "text", id: 3, mode: "move" });
  stale.update(1);
  useCapture.getState().updateText(3, { start: 5, end: 7 });
  assert.equal(stale.update(2), false);
  stale.cancel();
  assert.equal(useCapture.getState().texts[0].start, 5);
});

test("a scene switch or Try start rolls back unfinished timing without moving the new playhead", () => {
  setup();
  const state = useCapture.getState();
  const main = state.scenes[0];
  state.patch({
    scenes: [
      main,
      { ...main, id: "branch", name: "Branch", clips: [], texts: [] },
    ],
  });
  const drag = beginTimelineTimingDrag({ kind: "clip", id: 1, mode: "r" });
  drag.update(-1);
  state.patch({ currentSceneId: "branch", t: 0 });
  drag.commit();
  assert.equal(useCapture.getState().scenes[0].clips[0].out, 9);
  assert.equal(useCapture.getState().t, 0);
  assert.equal(useCapture.getState().past.length, 0);
  setup();
  const textDrag = beginTimelineTimingDrag({
    kind: "text",
    id: 3,
    mode: "move",
  });
  textDrag.update(1);
  useCapture
    .getState()
    .patch({
      tryMode: { playing: true, holdingId: null, handled: [], answers: {} },
      t: 0,
    });
  assert.equal(textDrag.update(2), false);
  textDrag.commit();
  assert.equal(useCapture.getState().texts[0].start, 1);
  assert.equal(useCapture.getState().t, 0);
});

test("short clips retain exact timing on a tap and cannot shrink below their current length", () => {
  const short = { ...clip, in: 1, out: 1.4, speed: 2 };
  for (const side of ["l", "r"]) {
    assert.equal(trimClipHandle(short, side, 0), short);
    assert.equal(trimClipHandle(short, side, 0.02), short);
  }
  assert.deepEqual(trimClipHandle(short, "l", 10), short);
  assert.deepEqual(trimClipHandle(short, "r", -10), short);
  assert.equal(trimClipHandle(short, "r", 0.5).out, 2.4);
  assert.equal(trimClipHandle(short, "l", -0.5).in, 0);
  setup();
  useCapture.getState().patch({ clips: [short] });
  const gesture = beginTimelineTimingDrag({
    kind: "clip",
    id: short.id,
    mode: "r",
  });
  gesture.update(0);
  gesture.commit();
  assert.equal(useCapture.getState().past.length, 0);
  assert.deepEqual(useCapture.getState().clips[0], short);
});
