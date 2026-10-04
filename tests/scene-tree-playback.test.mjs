import { createPlaybackTransitionState } from "../player/playback/transition-state.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import {
  packPvoProject,
  readPvoProject,
  validatePvo,
} from "../packages/pvo-sdk/index.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createTimelineReader } from "../player/playback/timeline.js";
import { createPlaybackTransitions } from "../player/playback/transitions.js";
import { createOutcomeRouter } from "../player/actions/outcomes.js";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { startTry, stopTry, runComponentResponse, advanceTry } from "./editor/src/features/preview/tryMode.ts";
      export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  useCapture,
  mkClip,
  initial,
  startTry,
  stopTry,
  runComponentResponse,
  advanceTry,
  buildPvoManifest,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

/** Main (8s) offers street (5s) or detail (3s); street offers detail. */
function project({
  responsePolicy = { dispatch: "interaction", unanswered: "continue" },
} = {}) {
  const scenes = [
    ["main", null, 8],
    ["street", "main", 5],
    ["detail", "street", 3],
  ].map(([id, parent, duration]) => ({
    id,
    parent,
    name: id === "main" ? "Main" : id,
    clips: [mkClip(duration, null, 0)],
    texts: [],
    components: [],
    muted: false,
    sound: 0,
    layers: ["video"],
  }));
  scenes[0].components.push({
    id: "choice-main",
    sceneId: "main",
    type: "choice",
    at: 2,
    dur: null,
    x: 50,
    y: 50,
    responsePolicy,
    fields: {
      prompt: "Next?",
      options: [
        { label: "Street", outcome: { kind: "scene", sceneId: "street" } },
        { label: "Detail", outcome: { kind: "scene", sceneId: "detail" } },
      ],
    },
  });
  scenes[1].components.push({
    id: "choice-street",
    sceneId: "street",
    type: "choice",
    at: 1,
    dur: null,
    x: 50,
    y: 50,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    fields: {
      prompt: "Next?",
      options: [
        { label: "Detail", outcome: { kind: "scene", sceneId: "detail" } },
        { label: "Continue", outcome: { kind: "continue" } },
      ],
    },
  });
  scenes[0].layers.push("component:choice-main");
  scenes[1].layers.push("component:choice-street");
  return {
    ...initial(),
    scenes,
    ...scenes[0],
    currentSceneId: "main",
    screen: "editor",
  };
}

function manifestFor(state) {
  return buildPvoManifest(
    state,
    state.scenes.map((scene) => ({
      scene,
      assetId: `asset-${scene.id}`,
      name: `media/${scene.id}.webm`,
      type: "video/webm",
    })),
  );
}

test("Try opens a tapped scene at once and the video ends there instead of returning", async () => {
  useCapture.setState(project());
  startTry();
  useCapture.getState().patch({ t: 3.5 });
  let state = useCapture.getState();
  await runComponentResponse(state.components[0], {
    index: 0,
    outcome: { kind: "scene", sceneId: "street" },
  });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "street");
  assert.equal(state.t, 0);
  state.patch({ t: 2 });
  await runComponentResponse(state.components[0], {
    index: 0,
    outcome: { kind: "scene", sceneId: "detail" },
  });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "detail");
  assert.equal(
    advanceTry(state, 2.9),
    false,
    "The branch keeps playing to its end",
  );
  assert.equal(advanceTry(useCapture.getState(), 3), true);
  state = useCapture.getState();
  assert.equal(state.tryMode, null, "The video ends with the selected branch");
  assert.equal(state.currentSceneId, "main", "Stop restores the editing scene");
  assert.equal(state.past.length, 0, "Viewer routes must not add edit history");
});

test("Try waits at the end of a layer when an unanswered response policy says pause", async () => {
  useCapture.setState(
    project({ responsePolicy: { dispatch: "layer_end", unanswered: "pause" } }),
  );
  startTry();
  useCapture.getState().patch({ t: 7.9 });
  assert.equal(advanceTry(useCapture.getState(), 8), true);
  let state = useCapture.getState();
  assert.equal(
    state.tryMode.holdingId,
    "choice-main",
    "Unanswered, the video waits at the layer end",
  );
  assert.equal(state.playing, false);
  assert.equal(state.currentSceneId, "main");
  await runComponentResponse(state.components[0], {
    index: 1,
    outcome: { kind: "scene", sceneId: "detail" },
  });
  state = useCapture.getState();
  assert.equal(
    state.currentSceneId,
    "detail",
    "The second option is the False route",
  );
  assert.equal(state.t, 0);
  assert.equal(state.playing, true);
  stopTry();
});

test("Try captures an early response and runs its route only when the layer ends", async () => {
  useCapture.setState(
    project({ responsePolicy: { dispatch: "layer_end", unanswered: "pause" } }),
  );
  startTry();
  useCapture.getState().patch({ t: 3 });
  let state = useCapture.getState();
  await runComponentResponse(state.components[0], {
    index: 0,
    outcome: { kind: "scene", sceneId: "street" },
  });
  state = useCapture.getState();
  assert.equal(
    state.currentSceneId,
    "main",
    "An early answer does not switch scenes yet",
  );
  assert.equal(state.tryMode.capturedResponses["choice-main"].index, 0);
  assert.deepEqual(state.tryMode.dispatched, []);
  assert.equal(advanceTry(state, 3.5), false);
  state.patch({ t: 7.9 });
  assert.equal(advanceTry(useCapture.getState(), 8), true);
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "street");
  assert.equal(state.t, 0);
  stopTry();
});

test("Try keeps the latest layer-end response before dispatch", async () => {
  useCapture.setState(
    project({
      responsePolicy: { dispatch: "layer_end", unanswered: "continue" },
    }),
  );
  startTry();
  useCapture.getState().patch({ t: 3 });
  let state = useCapture.getState();
  await runComponentResponse(state.components[0], {
    index: 0,
    outcome: { kind: "scene", sceneId: "street" },
  });
  await runComponentResponse(state.components[0], {
    index: 1,
    outcome: { kind: "scene", sceneId: "detail" },
  });
  state = useCapture.getState();
  assert.equal(state.currentSceneId, "main");
  assert.equal(state.tryMode.capturedResponses["choice-main"].index, 1);
  state.patch({ t: 7.9 });
  assert.equal(advanceTry(useCapture.getState(), 8), true);
  assert.equal(useCapture.getState().currentSceneId, "detail");
  stopTry();
});

test("interactive export writes response timing independently from the authored routes", () => {
  const manifest = manifestFor(
    project({ responsePolicy: { dispatch: "layer_end", unanswered: "pause" } }),
  );
  assert.deepEqual(validatePvo(manifest).errors, []);
  const [main, street] = manifest.components;
  assert.deepEqual(main.response_policy, {
    dispatch: "layer_end",
    unanswered: "pause",
  });
  assert.deepEqual(
    main.options.map((option) => option.action.type),
    ["goto_scene", "goto_scene"],
  );
  assert.deepEqual(
    main.restyle_capture.outcomes.map((outcome) => outcome.kind),
    ["scene", "scene"],
  );
  assert.equal(
    main.presentation.end,
    8,
    "The layer runs to the end of its clip",
  );
  assert.deepEqual(street.response_policy, {
    dispatch: "interaction",
    unanswered: "continue",
  });
  assert.equal(street.options[0].action.type, "goto_scene");
});

test("layer-end dispatch does not require a branch or two scene outcomes", () => {
  const state = project({
    responsePolicy: { dispatch: "layer_end", unanswered: "continue" },
  });
  state.scenes[0].components[0].fields.options[1].outcome = {
    kind: "continue",
  };
  const choice = manifestFor(state).components[0];
  assert.equal(choice.options[1].action.type, "custom");
  assert.deepEqual(choice.response_policy, {
    dispatch: "layer_end",
    unanswered: "continue",
  });
});

test("interactive export rejects components without the one current response-policy contract", () => {
  const state = project();
  delete state.scenes[0].components[0].responsePolicy;
  assert.throws(() => manifestFor(state), /require a response policy/);
});

test("interactive exports retain every scene parent and media regardless of selected scene or array order", async () => {
  const state = project();
  state.currentSceneId = "detail";
  state.scenes = [state.scenes[2], state.scenes[1], state.scenes[0]];
  const manifest = manifestFor(state);
  assert.equal(manifest.initial_scene, "main");
  assert.equal(manifest.playback.initial_timeline, "timeline-main");
  assert.deepEqual(
    manifest.scenes.map(({ id, parent }) => [id, parent]),
    [
      ["detail", "street"],
      ["street", "main"],
      ["main", null],
    ],
  );
  assert.deepEqual(validatePvo(manifest).errors, []);
  const packed = await packPvoProject({
    manifest,
    assets: state.scenes.map((scene) => ({
      id: `asset-${scene.id}`,
      name: `media/${scene.id}.webm`,
      blob: new Blob([scene.id], { type: "video/webm" }),
    })),
  });
  const decoded = await readPvoProject(packed);
  assert.deepEqual(decoded.manifest.scenes, manifest.scenes);
  assert.equal(decoded.assets.length, 3);
});

test("interactive export reports an empty branch instead of silently dropping part of the tree", () => {
  const state = project();
  assert.throws(
    () =>
      buildPvoManifest(state, [
        {
          scene: state.scenes[0],
          assetId: "main",
          name: "main.webm",
          type: "video/webm",
        },
      ]),
    /street.*whole scene tree/,
  );
});

test("scene parent validation rejects missing parents and cycles while retaining legacy flat manifests", () => {
  const manifest = manifestFor(project());
  const legacy = structuredClone(manifest);
  legacy.scenes.forEach((scene) => {
    delete scene.parent;
  });
  assert.equal(validatePvo(legacy).valid, true);
  manifest.scenes[1].parent = "missing";
  assert.match(
    validatePvo(manifest).errors.join(" "),
    /parent references missing scene/,
  );
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
  const video = {
    currentTime,
    paused: true,
    pause() {
      this.paused = true;
    },
    async play() {
      this.paused = false;
    },
  };
  const endScreen = { hidden: true };
  const timeline = createTimelineReader({
    session,
    readMediaTime: () => video.currentTime,
  });
  const adapters = {
    ...timeline,
    componentsForClip: () =>
      manifest.components.filter(
        (component) =>
          component.presentation.scene === timeline.activeClip()?.scene,
      ),
    componentCanReceiveResponse: () => true,
    renderOverlays() {},
    updateProgress() {},
    setStatus() {},
    showControls() {},
    async loadClip(index) {
      session.currentClipIndex = index;
      video.currentTime = 0;
    },
    async seekToElapsed(time) {
      video.currentTime = time;
    },
    replaceActionRuntime() {},
  };
  const router = createOutcomeRouter({
    session,
    refs: { video, endScreen: { hidden: false } },
    adapters,
  });
  const playback = createPlaybackTransitions({
    state: createPlaybackTransitionState(session),
    refs: { video, endScreen },
    adapters,
  });
  return { session, video, endScreen, router, playback };
}

test("the player opens a tapped scene at once and finishes when that branch ends", async () => {
  const { session, video, endScreen, router, playback } = playerFor(
    manifestFor(project()),
    { currentTime: 3.5 },
  );
  const [mainChoice, streetChoice] = session.manifest.components;
  await router.applyActionOutcome(mainChoice, 0, {
    kind: "scene",
    sceneId: "street",
  });
  assert.equal(session.currentTimeline.id, "timeline-street");
  video.currentTime = 2.5;
  await router.applyActionOutcome(streetChoice, 0, {
    kind: "scene",
    sceneId: "detail",
  });
  assert.equal(session.currentTimeline.id, "timeline-detail");
  playback.advanceAtClipEnd(true);
  await Promise.resolve();
  assert.equal(
    session.finished,
    true,
    "Nothing returns to the scene that routed here",
  );
  assert.equal(endScreen.hidden, false);
  assert.equal(session.currentTimeline.id, "timeline-detail");
});
