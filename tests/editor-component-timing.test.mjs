import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: 'export * from "./editor/src/store.ts"; export * from "./editor/src/state/components/componentTimingDrag.ts"; export * from "./editor/src/domain/components/timing.ts"; export * from "./editor/src/domain/scenes/duration.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, beginComponentTimingDrag, dragComponentTiming, clampComponentStart, sceneDuration } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
// Compare persisted content; history clones can materialize absent optional keys as undefined.
const projectData = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be ${expected}`);

/** One 8-second clip and a component added at 0:01, with no history yet. */
function fixture(type = "tooltip") {
  const clip = mkClip(8, null, 0);
  useCapture.setState({
    scenes: [{ id: "main", name: "Main", clips: [clip], texts: [], components: [], muted: false, sound: 0 }],
    currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"],
    t: 1, sel: -1, selComp: null, selText: null, past: [], future: [], sheet: null, tryMode: null, playheadPick: null,
  });
  const id = useCapture.getState().addComponent(type);
  useCapture.getState().patch({ past: [], future: [], sheet: null });
  return id;
}

function timing(id) {
  const component = useCapture.getState().components.find(item => item.id === id);
  return component ? { at: component.at, dur: component.dur } : null;
}

test("a timeline move previews without history and commits as one undo step", () => {
  const id = fixture();
  const original = projectData(useCapture.getState().scenes);
  const drag = beginComponentTimingDrag(id, "move");
  for (const delta of [.4, 1.1, 2]) assert(drag.update(delta));
  assert.equal(useCapture.getState().past.length, 0, "Live frames must not create undo entries");
  assert.deepEqual(timing(id), { at: 3, dur: 3 });
  drag.commit();
  const moved = projectData(useCapture.getState().scenes);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.deepEqual(projectData(useCapture.getState().scenes), original, "Undo returns to the pre-drag timing, not an earlier edit");
  assert.equal(useCapture.getState().components.length, 1, "Undo must not remove the dragged component");
  useCapture.getState().redo();
  assert.deepEqual(projectData(useCapture.getState().scenes), moved);
});

test("edge trims keep half a second, may extend the scene, and each commit once", () => {
  const id = fixture();
  const start = beginComponentTimingDrag(id, "start");
  start.update(10);
  assert.deepEqual(timing(id), { at: 3.5, dur: .5 });
  start.update(-10);
  assert.deepEqual(timing(id), { at: 0, dur: 4 });
  start.commit();
  assert.equal(useCapture.getState().past.length, 1);
  const end = beginComponentTimingDrag(id, "end");
  end.update(10);
  assert.deepEqual(timing(id), { at: 0, dur: 14 });
  end.update(-10);
  assert.deepEqual(timing(id), { at: 0, dur: .5 });
  end.commit();
  assert.equal(useCapture.getState().past.length, 2);
  useCapture.getState().undo();
  assert.deepEqual(timing(id), { at: 0, dur: 4 });
  useCapture.getState().undo();
  assert.deepEqual(timing(id), { at: 1, dur: 3 });
});

test("moving keeps until-clip-ends timing and stops a tenth of a second before the scene ends", () => {
  const id = fixture();
  useCapture.getState().updateComponent(id, { dur: null }, false);
  const drag = beginComponentTimingDrag(id, "move");
  drag.update(100);
  close(timing(id).at, 7.9);
  assert.equal(timing(id).dur, null);
  drag.update(-100);
  assert.deepEqual(timing(id), { at: 0, dur: null });
  drag.commit();
  assert.equal(useCapture.getState().past.length, 1);
});

test("a choice is a timed layer like any other component and can be moved and trimmed", () => {
  const id = fixture("choice");
  assert.deepEqual(timing(id), { at: 1, dur: 3 });
  const drag = beginComponentTimingDrag(id, "move");
  drag.update(2);
  assert.deepEqual(timing(id), { at: 3, dur: 3 });
  drag.commit();
  const end = beginComponentTimingDrag(id, "end");
  end.update(2);
  assert.deepEqual(timing(id), { at: 3, dur: 5 });
  end.commit();
  assert.equal(useCapture.getState().past.length, 2);
});

test("an explicit component move extends canonical scene duration", () => {
  const id = fixture();
  const drag = beginComponentTimingDrag(id, "move");
  drag.update(100);
  assert.deepEqual(timing(id), { at: 101, dur: 3 });
  assert.equal(sceneDuration(useCapture.getState()), 104);
  drag.commit();
  useCapture.getState().undo();
  assert.deepEqual(timing(id), { at: 1, dur: 3 });
  assert.equal(sceneDuration(useCapture.getState()), 8);
});

test("changing a tail component to until-clip-end normalizes it and clamps the playhead", () => {
  const id = fixture();
  useCapture.getState().updateComponent(id, { at: 12, dur: 8 }, false);
  useCapture.getState().patch({ t: 15, playing: true, past: [], future: [] });

  useCapture.getState().updateComponent(id, { dur: null });

  close(timing(id).at, 7.9);
  assert.equal(timing(id).dur, null);
  assert.equal(sceneDuration(useCapture.getState()), 8);
  assert.equal(useCapture.getState().t, 8);
  assert.equal(useCapture.getState().playing, false);
  assert.equal(useCapture.getState().past.length, 1);

  useCapture.getState().undo();
  assert.deepEqual(timing(id), { at: 12, dur: 8 });
  useCapture.getState().redo();
  close(timing(id).at, 7.9);
  assert.equal(timing(id).dur, null);
  assert.ok(useCapture.getState().t <= sceneDuration(useCapture.getState()));
});

test("component tail drag preserves the playhead until cancel or commit", () => {
  const id = fixture();
  useCapture.getState().updateComponent(id, { at: 7, dur: 13 }, false);
  useCapture.getState().patch({ t: 15, past: [], future: [] });

  const cancelled = beginComponentTimingDrag(id, "end");
  cancelled.update(-11);
  assert.deepEqual(timing(id), { at: 7, dur: 2 });
  assert.equal(useCapture.getState().t, 15, "Preview keeps the magnetic target stationary");
  cancelled.cancel();
  assert.deepEqual(timing(id), { at: 7, dur: 13 });
  assert.equal(useCapture.getState().t, 15);
  assert.equal(useCapture.getState().past.length, 0);

  const committed = beginComponentTimingDrag(id, "end");
  committed.update(-11);
  assert.equal(useCapture.getState().t, 15);
  committed.commit();
  assert.deepEqual(timing(id), { at: 7, dur: 2 });
  assert.equal(useCapture.getState().t, 9);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.deepEqual(timing(id), { at: 7, dur: 13 });
  useCapture.getState().redo();
  assert.deepEqual(timing(id), { at: 7, dur: 2 });
  assert.ok(useCapture.getState().t <= sceneDuration(useCapture.getState()));
});

test("deleting the final component tail clamps the active playhead atomically", () => {
  const id = fixture();
  useCapture.getState().updateComponent(id, { at: 12, dur: 8 }, false);
  useCapture.getState().patch({ t: 15, playing: true, past: [], future: [] });

  useCapture.getState().deleteComponent(id);

  assert.equal(useCapture.getState().components.length, 0);
  assert.equal(useCapture.getState().t, 8);
  assert.equal(useCapture.getState().playing, false);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.deepEqual(timing(id), { at: 12, dur: 8 });
  useCapture.getState().redo();
  assert.equal(timing(id), null);
  assert.ok(useCapture.getState().t <= sceneDuration(useCapture.getState()));
});

test("cancelling restores the starting timing and adds no history", () => {
  const id = fixture();
  const before = useCapture.getState();
  const drag = beginComponentTimingDrag(id, "end");
  drag.update(2);
  assert.deepEqual(timing(id), { at: 1, dur: 5 });
  drag.cancel();
  assert.deepEqual(timing(id), { at: 1, dur: 3 });
  assert.strictEqual(useCapture.getState().past, before.past);
  assert.strictEqual(useCapture.getState().future, before.future);
});

test("a drag returned to its starting time adds no undo entry", () => {
  const id = fixture();
  const drag = beginComponentTimingDrag(id, "move");
  drag.update(1.5);
  drag.update(0);
  drag.commit();
  assert.equal(useCapture.getState().past.length, 0);
  assert.deepEqual(timing(id), { at: 1, dur: 3 });
});

test("a newer edit or viewer preview stops a stale drag from overwriting it", () => {
  const id = fixture();
  const drag = beginComponentTimingDrag(id, "move");
  drag.update(1);
  useCapture.getState().updateComponent(id, { at: 5 });
  assert.equal(drag.update(2), false);
  drag.cancel();
  assert.deepEqual(timing(id), { at: 5, dur: 3 });
  useCapture.getState().patch({ tryMode: { playing: true, holdingId: null, handled: [], answers: {} } });
  assert.equal(beginComponentTimingDrag(id, "move"), null);
});

test("an external scene switch cancels a drag in its original scene", () => {
  const id = fixture();
  const state = useCapture.getState();
  const main = state.scenes[0];
  state.patch({ scenes: [main, { ...main, id: "branch", name: "Branch", components: [], layers: ["video"] }] });
  const drag = beginComponentTimingDrag(id, "move");
  drag.update(2);
  state.patch({ currentSceneId: "branch" });
  drag.cancel();
  const after = useCapture.getState();
  assert.equal(after.currentSceneId, "branch");
  assert.deepEqual(after.scenes[0].components.map(component => component.at), [1]);
  assert.equal(after.past.length, 0);
});

test("shared timing rules only video-bound until-clip-end components", () => {
  assert.equal(clampComponentStart(12, 3, 8), 12);
  assert.equal(clampComponentStart(-1, 3, 8), 0);
  close(clampComponentStart(12, null, 8), 7.9);
  assert.equal(clampComponentStart(3, null, 0), 0);
  assert.deepEqual(dragComponentTiming({ at: 1, dur: 3, length: 3 }, "move", .5, 8), { at: 1.5 });
  assert.deepEqual(dragComponentTiming({ at: 1, dur: 3, length: 3 }, "start", -.5, 8), { at: .5, dur: 3.5 });
  assert.deepEqual(dragComponentTiming({ at: 1, dur: 3, length: 3 }, "end", 1, 8), { dur: 4 });
  assert.deepEqual(dragComponentTiming({ at: 1, dur: 3, length: 3 }, "end", 20, 8), { dur: 23 });
  assert.deepEqual(dragComponentTiming({ at: 1, dur: null, length: 7 }, "move", 20, 8), { at: 7.9 });
});
