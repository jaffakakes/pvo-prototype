import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { packPvoProject, readPvoProject, validatePvo } from "../packages/pvo-sdk/index.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createTimelineReader } from "../player/playback/timeline.js";
import { createPlaybackTransitions } from "../player/playback/transitions.js";
import { createOutcomeRouter } from "../player/actions/outcomes.js";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { startTry, stopTry, runOutcome, advanceTry } from "./editor/src/features/preview/tryMode.ts";
      export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, startTry, stopTry, runOutcome, advanceTry, buildPvoManifest } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

/** Main (8s) offers street (5s) or detail (3s); street offers detail. The main choice may branch at its layer end. */
function project({ branchAtEnd = false } = {}) {
  const scenes = [["main", null, 8], ["street", "main", 5], ["detail", "street", 3]]
    .map(([id, parent, duration]) => ({
      id, parent, name: id === "main" ? "Main" : id, clips: [mkClip(duration, null, 0)],
      texts: [], components: [], muted: false, sound: 0, layers: ["video"],
    }));
  scenes[0].components.push({
    id: "choice-main", sceneId: "main", type: "choice", at: 2, dur: null, x: 50, y: 50, branchAtEnd,
    fields: { prompt: "Next?", options: [
      { label: "Street", outcome: { kind: "scene", sceneId: "street" } },
      { label: "Detail", outcome: { kind: "scene", sceneId: "detail" } },
    ] },
  });
  scenes[1].components.push({
    id: "choice-street", sceneId: "street", type: "choice", at: 1, dur: null, x: 50, y: 50,
    fields: { prompt: "Next?", options: [
      { label: "Detail", outcome: { kind: "scene", sceneId: "detail" } },
      { label: "Continue", outcome: { kind: "continue" } },
    ] },
  });
  scenes[0].layers.push("component:choice-main");
  scenes[1].layers.push("component:choice-street");
  return { ...initial(), scenes, ...scenes[0], currentSceneId: "main", screen: "editor" };
}

function manifestFor(state) {
  return buildPvoManifest(state, state.scenes.map(scene => ({
    scene, assetId: `asset-${scene.id}`, name: `media/${scene.id}.webm`, type: "video/webm",
  })));
}

test("Try opens a tapped scene at once and the video ends there instead of returning", async () => {
  useCapture.setState(project());
  startTry();
  useCapture.getState().patch({ t: 3.5 });
  let state = useCapture.getState();
  await runOutcome(state.components[0], { kind: "scene", sceneId: "street" });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "street");
  assert.equal(state.t, 0);
  state.patch({ t: 2 });
  await runOutcome(state.components[0], { kind: "scene", sceneId: "detail" });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "detail");
  assert.equal(advanceTry(state, 2.9), false, "The branch keeps playing to its end");
  assert.equal(advanceTry(useCapture.getState(), 3), true);
  state = useCapture.getState();
  assert.equal(state.tryMode, null, "The video ends with the selected branch");
  assert.equal(state.currentSceneId, "main", "Stop restores the editing scene");
  assert.equal(state.past.length, 0, "Viewer routes must not add edit history");
});

test("Try waits at the end of a branch-at-end choice, then opens the answered scene", async () => {
  useCapture.setState(project({ branchAtEnd: true }));
  startTry();
  useCapture.getState().patch({ t: 7.9 });
  assert.equal(advanceTry(useCapture.getState(), 8), true);
  let state = useCapture.getState();
  assert.equal(state.tryMode.holdingId, "choice-main", "Unanswered, the video waits at the layer end");
  assert.equal(state.playing, false);
  assert.equal(state.currentSceneId, "main");
  await runOutcome(state.components[0], { kind: "scene", sceneId: "detail" });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "detail", "The second option is the False route");
  assert.equal(state.t, 0);
  assert.equal(state.playing, true);
  stopTry();
});

test("Try remembers an early answer and branches only when the layer ends", async () => {
  useCapture.setState(project({ branchAtEnd: true }));
  startTry();
  useCapture.getState().patch({ t: 3 });
  let state = useCapture.getState();
  await runOutcome(state.components[0], { kind: "scene", sceneId: "street" });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "main", "An early answer does not switch scenes yet");
  assert.deepEqual(state.tryMode.answers, { "choice-main": true });
  assert.equal(advanceTry(state, 3.5), false);
  state.patch({ t: 7.9 });
  assert.equal(advanceTry(useCapture.getState(), 8), true);
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "street");
  assert.equal(state.t, 0);
  stopTry();
});

test("interactive export writes the documented end-of-layer branch and keeps a plain choice immediate", () => {
  const manifest = manifestFor(project({ branchAtEnd: true }));
  assert.deepEqual(validatePvo(manifest).errors, []);
  const [main, street] = manifest.components;
  assert.deepEqual(main.scene_change, { enabled: true, executeAt: "end", routes: [
    { condition: "true", sceneId: "street" }, { condition: "false", sceneId: "detail" },
  ] });
  assert.deepEqual(main.options.map(option => option.action.type), ["custom", "custom"], "Taps only record the answer");
  assert.deepEqual(main.restyle_capture.outcomes.map(outcome => outcome.kind), ["continue", "continue"]);
  assert.equal(main.presentation.end, 8, "The layer runs to the end of its clip");
  assert.equal(main.pause, undefined);
  assert.equal(main.restyle_capture.hold, undefined);
  assert.equal(manifest.restyle_capture.routing, undefined);
  assert.equal(street.scene_change, undefined);
  assert.equal(street.options[0].action.type, "goto_scene");
});

test("export refuses Branch at layer end without two different scenes", () => {
  const state = project({ branchAtEnd: true });
  state.scenes[0].components[0].fields.options[1].outcome = { kind: "continue" };
  assert.throws(() => manifestFor(state), /both options a scene/);
});

test("projects saved with hold components upgrade to timed layers that keep their branch", () => {
  const state = project();
  const legacyMain = { ...state.scenes[0], components: [
    { ...state.scenes[0].components[0], dur: null, hold: true },
    { id: "form-main", sceneId: "main", type: "form", at: 4, hold: true, dur: null, x: 50, y: 50,
      fields: { heading: "Tell us", formFields: [{ name: "Name", type: "text" }], submitLabel: "Send",
        destination: "", successOutcome: { kind: "continue" }, failureOutcome: null } },
  ] };
  useCapture.setState({ ...state, scenes: [legacyMain, state.scenes[1], state.scenes[2]] });
  useCapture.getState().patch({ scenes: useCapture.getState().scenes });
  const [choice, form] = useCapture.getState().scenes[0].components;
  assert.equal("hold" in choice, false);
  assert.equal(choice.dur, null, "A held choice now shows until its clip ends");
  assert.equal(choice.branchAtEnd, true, "Two scene routes keep the stop-and-route intent at the layer end");
  assert.equal("hold" in form, false);
  assert.equal(form.branchAtEnd, undefined);
  assert.equal(form.dur, null);
  assert.deepEqual(validatePvo(manifestFor(useCapture.getState())).errors, []);
});

test("interactive exports retain every scene parent and media regardless of selected scene or array order", async () => {
  const state = project();
  state.currentSceneId = "detail";
  state.scenes = [state.scenes[2], state.scenes[1], state.scenes[0]];
  const manifest = manifestFor(state);
  assert.equal(manifest.initial_scene, "main");
  assert.equal(manifest.playback.initial_timeline, "timeline-main");
  assert.deepEqual(manifest.scenes.map(({ id, parent }) => [id, parent]), [
    ["detail", "street"], ["street", "main"], ["main", null],
  ]);
  assert.deepEqual(validatePvo(manifest).errors, []);
  const packed = await packPvoProject({ manifest, assets: state.scenes.map(scene => ({
    id: `asset-${scene.id}`, name: `media/${scene.id}.webm`, blob: new Blob([scene.id], { type: "video/webm" }),
  })) });
  const decoded = await readPvoProject(packed);
  assert.deepEqual(decoded.manifest.scenes, manifest.scenes);
  assert.equal(decoded.assets.length, 3);
});

test("interactive export reports an empty branch instead of silently dropping part of the tree", () => {
  const state = project();
  assert.throws(() => buildPvoManifest(state, [{
    scene: state.scenes[0], assetId: "main", name: "main.webm", type: "video/webm",
  }]), /street.*whole scene tree/);
});

test("scene parent validation rejects missing parents and cycles while retaining legacy flat manifests", () => {
  const manifest = manifestFor(project());
  const legacy = structuredClone(manifest);
  legacy.scenes.forEach(scene => { delete scene.parent; });
  assert.equal(validatePvo(legacy).valid, true);
  manifest.scenes[1].parent = "missing";
  assert.match(validatePvo(manifest).errors.join(" "), /parent references missing scene/);
  manifest.scenes[1].parent = "detail";
  assert.match(validatePvo(manifest).errors.join(" "), /cycle/);
  manifest.scenes[1].parent = null;
  assert.match(validatePvo(manifest).errors.join(" "), /exactly one root/);
});

/** A player wired like app.js, with a fake media element and no DOM. */
function playerFor(manifest, { currentTime = 0 } = {}) {
  const session = createPlaybackSession();
  session.manifest = manifest;
  session.captureMode = true;
  session.currentTimeline = manifest.playback.timelines[0];
  const video = { currentTime, paused: true, pause() { this.paused = true; }, async play() { this.paused = false; } };
  const endScreen = { hidden: true };
  const timeline = createTimelineReader({ session, readMediaTime: () => video.currentTime });
  const adapters = {
    ...timeline,
    componentsForClip: () => manifest.components.filter(component => component.presentation.scene === timeline.activeClip()?.scene),
    captureAboveVideo: () => true,
    renderOverlays() {}, updateProgress() {}, setStatus() {}, showControls() {},
    async loadClip(index) { session.currentClipIndex = index; video.currentTime = 0; },
    async seekToElapsed(time) { video.currentTime = time; },
    routeForAnswer: (...args) => router.routeForAnswer(...args),
    startSelectedBranch: (...args) => playback.startSelectedBranch(...args),
  };
  const router = createOutcomeRouter({ session, refs: { video }, adapters });
  const playback = createPlaybackTransitions({ session, refs: { video, endScreen }, adapters });
  return { session, video, endScreen, router, playback };
}

test("the player opens a tapped scene at once and finishes when that branch ends", async () => {
  const { session, video, endScreen, router, playback } = playerFor(manifestFor(project()), { currentTime: 3.5 });
  const [mainChoice, streetChoice] = session.manifest.components;
  await router.applyActionOutcome(mainChoice, 0, { kind: "scene", sceneId: "street" });
  assert.equal(session.currentTimeline.id, "timeline-street");
  video.currentTime = 2.5;
  await router.applyActionOutcome(streetChoice, 0, { kind: "scene", sceneId: "detail" });
  assert.equal(session.currentTimeline.id, "timeline-detail");
  playback.advanceAtClipEnd(true);
  await Promise.resolve();
  assert.equal(session.finished, true, "Nothing returns to the scene that routed here");
  assert.equal(endScreen.hidden, false);
  assert.equal(session.currentTimeline.id, "timeline-detail");
});

test("the player waits at the end of a scene_change layer and opens the answered route", async () => {
  const { session, video, router, playback } = playerFor(manifestFor(project({ branchAtEnd: true })));
  const [mainChoice] = session.manifest.components;
  video.currentTime = 8;
  assert.equal(playback.branchAtCurrentTime(), true);
  assert.equal(session.awaitingComponent?.id, "choice-main");
  assert.equal(video.paused, true);
  session.answers.set("choice-main", false);
  await router.applyActionOutcome(mainChoice, 1, { kind: "continue" });
  assert.equal(session.currentTimeline.id, "timeline-detail", "The second option is the False route");
  assert.equal(session.awaitingComponent, null);
});

test("the player remembers an early answer and branches when the layer ends", async () => {
  const { session, video, router, playback } = playerFor(manifestFor(project({ branchAtEnd: true })), { currentTime: 3 });
  const [mainChoice] = session.manifest.components;
  session.answers.set("choice-main", true);
  await router.applyActionOutcome(mainChoice, 0, { kind: "continue" });
  assert.equal(session.currentTimeline.id, "timeline-main", "An early answer keeps playing");
  assert.equal(video.paused, false);
  assert.equal(playback.branchAtCurrentTime(), false);
  video.currentTime = 8;
  assert.equal(playback.branchAtCurrentTime(), true);
  await Promise.resolve();
  assert.equal(session.currentTimeline.id, "timeline-street");
});
