import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
  export * from './editor/src/store.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export * from './editor/src/state/animation/timelineControls.ts';
  export { useAnimationSelection } from './editor/src/state/animation/selection.ts';
  export { setAuthoringValue } from './editor/src/state/animation/commands.ts';
  export { beginStageAnimationTransform } from './editor/src/state/animation/stageGesture.ts';
  export * from './editor/src/domain/animation/authoring.ts';
`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const state = () => api.useCapture.getState();
const snapshot = () => JSON.parse(JSON.stringify(state().scenes));
function fixture(clipValues = {}) {
  api.useCapture.setState(api.initial());
  const clip = { ...api.mkClip(8, null, 0), ...clipValues };
  state().patch({
    screen: "editor",
    clips: [clip],
    sel: 0,
    t: 0,
    sheet: null,
    past: [],
    future: [],
  });
  return clip;
}

test("selecting a music key preserves its layer selection and source clock", () => {
  fixture();
  state().patch({
    music: { track: 1, start: 2, duration: 4, offset: 1, gain: 1 },
    sel: -1,
    selMusic: true,
    t: 2,
  });
  assert.equal(api.toggleTimelineKeyframe(), true);
  assert.equal(state().selMusic, true);
  assert.equal(
    api.useAnimationSelection.getState().selection.target.kind,
    "music",
  );
  assert.equal(state().music.animation.tracks.gain[0].time, 1);
  state().patch({ t: 3 });
  assert.equal(api.selectTimelineKeyframe(2), true);
  assert.equal(state().selMusic, true);
  assert.equal(state().t, 2);
  assert.equal(api.selectedTimelineAnimation(state()).target.kind, "music");
});

test("timeline diamond captures the complete visual transform in source time and toggles it in one Undo", () => {
  fixture({ in: 4, out: 8, speed: 2 });
  state().patch({ t: 1 });
  const before = snapshot();
  assert.equal(api.toggleTimelineKeyframe(), true);
  const tracks = state().clips[0].animation.tracks;
  assert.deepEqual(Object.keys(tracks).sort(), [
    "opacity",
    "rotation",
    "scaleX",
    "scaleY",
    "x",
    "y",
  ]);
  assert(
    Object.values(tracks).every(
      (keys) => keys.length === 1 && keys[0].time === 6,
    ),
  );
  assert.equal(state().past.length, 1);
  assert.equal(
    state().sheet,
    null,
    "Adding a point does not open a tab or panel",
  );
  const captured = snapshot();
  assert.equal(api.toggleTimelineKeyframe(), true);
  assert.equal(state().past.length, 2);
  state().undo();
  assert.deepEqual(snapshot(), captured);
  state().undo();
  assert.deepEqual(snapshot(), before);
});

test("Graphs edits the segment under the playhead, changes real interpolation and preserves audio", () => {
  const key = (value) => [{ time: 0, value, easing: "linear" }];
  const clip = fixture({ animation: { tracks: { gain: key(0.4) } } });
  api.toggleTimelineKeyframe();
  state().patch({ t: 2 });
  api.toggleTimelineKeyframe();
  api.setAuthoringValue({ kind: "clip", id: clip.id }, "position", 2, {
    x: 70,
    y: 50,
  });
  state().patch({ t: 1 });
  const before = snapshot();
  const history = state().past.length;
  assert.equal(api.toggleTimelineGraphs(), true);
  assert.equal(state().sheet, "keyframes");
  assert.equal(state().t, 1, "Opening Graphs does not move the playhead");
  assert.equal(state().past.length, history);
  assert.equal(api.setTimelineEasing("ease-in"), true);
  const tracks = state().clips[0].animation.tracks;
  for (const property of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"])
    assert.equal(tracks[property][0].easing, "ease-in");
  assert.deepEqual(tracks.gain, key(0.4));
  const midpoint = api.readAuthoringValue(
    state().scenes[0],
    { kind: "clip", id: clip.id },
    "position",
    1,
  );
  assert(
    midpoint.x < 60 && midpoint.x > 50,
    "Speed up begins more slowly than a linear segment",
  );
  assert.equal(state().past.length, history + 1);
  state().undo();
  assert.deepEqual(snapshot(), before);
});

test("Graphs never creates points when none exist, and the final point has no outgoing curve", () => {
  fixture();
  const before = snapshot();
  api.toggleTimelineGraphs();
  assert.equal(api.setTimelineEasing("ease-in"), false);
  assert.deepEqual(snapshot(), before);
  assert.equal(state().past.length, 0);
  api.toggleTimelineKeyframe();
  assert.equal(api.setTimelineEasing("ease-in"), false);
  state().patch({ t: 2 });
  api.toggleTimelineKeyframe();
  assert.equal(api.selectedTimelineAnimation(state()).segment.next, null);
  assert.equal(api.setTimelineEasing("ease-in"), false);
  state().patch({ t: 1 });
  assert.equal(api.selectedTimelineAnimation(state()).segment.key.time, 0);
  assert.equal(api.selectedTimelineAnimation(state()).segment.next.time, 2);
});

test("volume mode keys only gain and keeps the same source clock through Graphs", () => {
  fixture({ in: 4, out: 8, speed: 2 });
  state().patch({ sheet: "volume", t: 0.5 });
  api.toggleTimelineKeyframe();
  assert.deepEqual(Object.keys(state().clips[0].animation.tracks), ["gain"]);
  assert.equal(state().clips[0].animation.tracks.gain[0].time, 5);
  state().patch({ t: 1.5 });
  api.toggleTimelineKeyframe();
  state().patch({ t: 1 });
  api.toggleTimelineGraphs();
  assert.equal(state().sheet, "volumeKeyframes");
  api.setTimelineEasing("ease-out");
  assert.equal(state().clips[0].animation.tracks.gain[0].easing, "ease-out");
  assert.equal(state().clips[0].animation.tracks.gain[1].easing, "linear");
});

test("unselected, out-of-range and blocked timeline controls leave the project unchanged", () => {
  fixture();
  const before = snapshot();
  for (const values of [
    { sel: -1 },
    { sel: 0, t: 9 },
    { t: 0, recording: true },
  ]) {
    state().patch(values);
    assert.equal(api.toggleTimelineKeyframe(), false);
    assert.equal(api.toggleTimelineGraphs(), false);
    assert.equal(api.setTimelineEasing("hold"), false);
    assert.deepEqual(snapshot(), before);
    assert.equal(state().past.length, 0);
  }
});

test("cancelling a keyframe gesture rolls back curves without undoing navigation", () => {
  const clip = fixture();
  api.toggleTimelineKeyframe();
  const before = snapshot();
  let gesture = api.beginStageAnimationTransform(
    { kind: "clip", id: clip.id },
    false,
  );
  gesture.update({ x: 65, y: 35, size: 1.4, rotation: 25 });
  state().patch({ sel: -1, sheet: null });
  gesture.cancel();
  assert.equal(state().sel, -1, "Cancelling must not reselect the old layer");
  assert.deepEqual(snapshot(), before);
  assert.equal(state().past.length, 1);
  state().patch({ sel: 0, t: 0 });
  gesture = api.beginStageAnimationTransform(
    { kind: "clip", id: clip.id },
    false,
  );
  gesture.update({ x: 55, y: 45, size: 1.2, rotation: 15 });
  state().patch({ t: 2 });
  gesture.cancel();
  assert.equal(
    state().t,
    2,
    "Cancelling must preserve a newly chosen playhead time",
  );
  assert.deepEqual(snapshot(), before);
});

test("strip point selection seeks exactly without editing, even from outside the selected clip", () => {
  fixture();
  api.toggleTimelineKeyframe();
  state().patch({ t: 2 });
  api.toggleTimelineKeyframe();
  const before = snapshot();
  state().patch({ t: 9 });
  assert.equal(api.selectTimelineKeyframe(2), true);
  assert.equal(state().t, 2);
  assert.deepEqual(snapshot(), before);
  assert.equal(state().past.length, 2);
  assert.equal(api.selectTimelineKeyframe(1), false);
  assert.equal(state().t, 2);
});
