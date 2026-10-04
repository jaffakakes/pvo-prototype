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
  desktopLayerLayout,
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
const DESKTOP_ZOOM = 40;
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

test("desktop visual layers use the minimum tracks and reuse touching intervals", () => {
  const source = {
    clips: [{ ...clip, srcDur: 8, in: 0, out: 8, speed: 1 }],
    texts: [
      { id: 11, text: "First", start: 0, end: 2 },
      { id: 12, text: "Second", start: 1, end: 3 },
      { id: 13, text: "Third", start: 3, end: 5 },
    ],
    components: [
      { id: "card", at: 2, dur: 2 },
      { id: "choice", at: 4, dur: 2 },
    ],
    layers: [
      "video",
      "text:11",
      "component:card",
      "text:12",
      "text:13",
      "component:choice",
    ],
  };
  const before = structuredClone(source);

  assert.deepEqual(desktopLayerLayout(source, DESKTOP_ZOOM), {
    rows: [
      {
        id: "overlay:front:0",
        kind: "overlay",
        side: "front",
        layerIds: ["text:11", "component:card", "component:choice"],
      },
      {
        id: "overlay:front:1",
        kind: "overlay",
        side: "front",
        layerIds: ["text:12", "text:13"],
      },
      { id: "video", kind: "video", layerIds: ["video"] },
    ],
    rowIndexByLayer: {
      "text:11": 0,
      "component:card": 0,
      "component:choice": 0,
      "text:12": 1,
      "text:13": 1,
      video: 2,
    },
  });
  assert.deepEqual(
    source,
    before,
    "packing must not reorder or mutate project data",
  );
});

test("desktop packing separates overlapping minimum hit targets", () => {
  const source = {
    clips: [],
    texts: [
      { id: 11, text: "First", start: 0, end: 0.1 },
      { id: 12, text: "Adjacent", start: 0.1, end: 0.2 },
      { id: 13, text: "Separated", start: 0.8, end: 0.9 },
    ],
    components: [],
    layers: ["video", "text:11", "text:12", "text:13"],
  };

  const layout = desktopLayerLayout(source, DESKTOP_ZOOM);

  assert.deepEqual(
    layout.rows.map((row) => row.layerIds),
    [[], ["text:11", "text:13"], ["text:12"], ["video"]],
    "Four-pixel clips need separate rows when their 28px targets overlap, while separated targets can reuse a row",
  );
});

test("desktop layer packing resolves equal starts by canonical z-order", () => {
  const source = {
    clips: [{ ...clip, srcDur: 8, in: 0, out: 8, speed: 1 }],
    texts: [
      { id: 11, text: "Back text", start: 1, end: 4 },
      { id: 12, text: "Front text", start: 1, end: 4 },
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
  const expected = desktopLayerLayout(source, DESKTOP_ZOOM);

  assert.deepEqual(
    expected.rows.map((row) => row.layerIds),
    [
      ["component:choice"],
      ["text:12"],
      ["component:card"],
      ["text:11"],
      ["video"],
    ],
    "four concurrent overlays require four deterministic tracks",
  );
  assert.deepEqual(
    desktopLayerLayout(
      {
        ...source,
        texts: source.texts.slice().reverse(),
        components: source.components.slice().reverse(),
      },
      DESKTOP_ZOOM,
    ),
    expected,
    "storage-array order must not change track assignment",
  );
});

test("desktop layer packing keeps front and back overlays on opposite sides of video", () => {
  const source = {
    clips: [{ ...clip, srcDur: 8, in: 0, out: 8, speed: 1 }],
    texts: [
      { id: 11, text: "Behind", start: 1, end: 2 },
      { id: 12, text: "In front", start: 0, end: 1 },
    ],
    components: [
      { id: "behind", at: 0, dur: 1 },
      { id: "front", at: 1, dur: 1 },
    ],
    layers: [
      "component:behind",
      "text:11",
      "video",
      "text:12",
      "component:front",
    ],
  };

  assert.deepEqual(desktopLayerLayout(source, DESKTOP_ZOOM), {
    rows: [
      {
        id: "overlay:front:0",
        kind: "overlay",
        side: "front",
        layerIds: ["text:12", "component:front"],
      },
      { id: "video", kind: "video", layerIds: ["video"] },
      {
        id: "overlay:back:0",
        kind: "overlay",
        side: "back",
        layerIds: ["component:behind", "text:11"],
      },
    ],
    rowIndexByLayer: {
      "text:12": 0,
      "component:front": 0,
      video: 1,
      "component:behind": 2,
      "text:11": 2,
    },
  });
});

test("desktop layer layout retains add targets for each empty visual type", () => {
  assert.deepEqual(
    desktopLayerLayout(
      {
        clips: [],
        texts: [],
        components: [],
        layers: ["video"],
      },
      DESKTOP_ZOOM,
    ),
    {
      rows: [
        { id: "add:components", kind: "empty-components", layerIds: [] },
        { id: "add:text", kind: "empty-text", layerIds: [] },
        { id: "video", kind: "video", layerIds: ["video"] },
      ],
      rowIndexByLayer: { video: 2 },
    },
  );

  assert.deepEqual(
    desktopLayerLayout(
      {
        clips: [],
        texts: [{ id: 11, start: 0, end: 1 }],
        components: [],
        layers: ["video", "text:11"],
      },
      DESKTOP_ZOOM,
    ),
    {
      rows: [
        { id: "add:components", kind: "empty-components", layerIds: [] },
        {
          id: "overlay:front:0",
          kind: "overlay",
          side: "front",
          layerIds: ["text:11"],
        },
        { id: "video", kind: "video", layerIds: ["video"] },
      ],
      rowIndexByLayer: { "text:11": 1, video: 2 },
    },
  );

  assert.deepEqual(
    desktopLayerLayout(
      {
        clips: [],
        texts: [],
        components: [{ id: "card", at: 0, dur: 1 }],
        layers: ["video", "component:card"],
      },
      DESKTOP_ZOOM,
    ),
    {
      rows: [
        { id: "add:text", kind: "empty-text", layerIds: [] },
        {
          id: "overlay:front:0",
          kind: "overlay",
          side: "front",
          layerIds: ["component:card"],
        },
        { id: "video", kind: "video", layerIds: ["video"] },
      ],
      rowIndexByLayer: { "component:card": 1, video: 2 },
    },
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
  assert.equal(stale.commit(), false);
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
  assert.equal(drag.commit(), false);
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
  useCapture.getState().patch({
    tryMode: { playing: true, holdingId: null, handled: [], answers: {} },
    t: 0,
  });
  assert.equal(textDrag.update(2), false);
  assert.equal(textDrag.commit(), false);
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
