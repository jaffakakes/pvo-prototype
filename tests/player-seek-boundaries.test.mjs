import { createPlaybackTransitionState } from "../player/playback/transition-state.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createOutcomeRouter } from "../player/actions/outcomes.js";
import { createVideoController } from "../player/media/video.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createTimelineReader } from "../player/playback/timeline.js";
import { createPlaybackTransitions } from "../player/playback/transitions.js";

function choice(
  id,
  policy = { dispatch: "layer_end", unanswered: "pause" },
  end = 5,
) {
  return {
    id,
    kind: "choice",
    response_policy: policy,
    presentation: {
      scene: "main",
      start: 1,
      end,
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.3,
    },
    options: [
      { label: "First", action: { type: "custom", name: "first" } },
      { label: "Second", action: { type: "custom", name: "second" } },
    ],
  };
}

function seekHarness(components, { currentTime = 2, dispatch } = {}) {
  const session = createPlaybackSession();
  session.captureMode = true;
  session.manifest = { components };
  session.currentTimeline = {
    id: "main",
    clips: [
      { id: "clip", asset_id: "video", scene: "main", start: 0, end: 10 },
    ],
  };
  session.actionRuntime = {};
  session.assets.set("video", {});
  session.assetUrls.set("video", "blob:video");
  const video = {
    currentTime,
    paused: true,
    dataset: { assetId: "video" },
    pause() {
      this.paused = true;
    },
    async play() {
      this.paused = false;
    },
  };
  const timeline = createTimelineReader({
    session,
    readMediaTime: () => video.currentTime,
  });
  const dispatched = [];
  const statuses = [];
  const media = createVideoController({
    session,
    refs: { video },
    adapters: {
      ...timeline,
      updateTimelineLabel() {},
      finishExperience() {},
      renderOverlays() {},
      updateProgress() {},
      setStatus(message) {
        statuses.push(message);
      },
      showControls() {},
      replaceActionRuntime() {},
      componentCanReceiveResponse: () => true,
      async dispatchCapturedResponse(id) {
        dispatched.push(id);
        if (dispatch) return dispatch(id);
        session.capturedResponses.get(id).status = "complete";
        session.awaitingComponent = null;
      },
    },
  });
  return { session, video, timeline, media, dispatched, statuses };
}

test("viewer scrubbing stops at an unanswered required boundary", async () => {
  const component = choice("required");
  const harness = seekHarness([component]);

  await harness.media.seekToElapsed(8);

  assert.equal(harness.video.currentTime, 5);
  assert.equal(harness.session.awaitingComponent, component);
  assert.deepEqual(harness.dispatched, []);
  assert.equal(harness.statuses.at(-1), "Choose to continue");
});

test("a hidden response boundary is consumed without dispatching or rewinding later", async () => {
  const component = choice("hidden");
  const harness = seekHarness([component]);
  harness.session.capturedResponses.set(component.id, {
    componentId: component.id,
    index: 0,
    status: "captured",
  });
  harness.session.forcedHidden.add(component.id);

  await harness.media.seekToElapsed(8);
  harness.session.forcedHidden.delete(component.id);

  assert.equal(harness.video.currentTime, 8);
  assert.deepEqual(harness.dispatched, []);
  assert.equal(harness.session.handledResponses.has(component.id), true);
});

test("an authored seek skips response boundaries instead of dispatching them en route", async () => {
  const skipped = choice("skipped");
  const harness = seekHarness([skipped]);
  harness.session.capturedResponses.set(skipped.id, {
    componentId: skipped.id,
    index: 1,
    status: "captured",
  });
  const endScreen = { hidden: false };
  const router = createOutcomeRouter({
    session: harness.session,
    refs: { video: harness.video, endScreen },
    adapters: {
      seekToElapsed: (...args) => harness.media.seekToElapsed(...args),
      renderOverlays() {},
      showControls() {},
    },
  });

  await router.applyActionOutcome({ id: "source" }, 0, { kind: "time", t: 8 });

  assert.equal(harness.video.currentTime, 8);
  assert.deepEqual(harness.dispatched, []);
  assert.equal(harness.session.handledResponses.has(skipped.id), true);
});

test("restart invalidates a crossed response before its late completion can restore the old seek", async () => {
  const component = choice("deferred");
  let finishDispatch;
  const dispatched = new Promise((resolve) => {
    finishDispatch = resolve;
  });
  const harness = seekHarness([component], {
    dispatch: async (id) => {
      await dispatched;
      const response = harness.session.capturedResponses.get(id);
      if (response) response.status = "complete";
      harness.session.awaitingComponent = null;
    },
  });
  harness.session.manifest.playback = {
    initial_timeline: "main",
    timelines: [harness.session.currentTimeline],
  };
  harness.session.capturedResponses.set(component.id, {
    componentId: component.id,
    index: 0,
    status: "captured",
  });
  const transitions = createPlaybackTransitions({
    state: createPlaybackTransitionState(harness.session),
    refs: { video: harness.video, endScreen: { hidden: true } },
    adapters: {
      ...harness.timeline,
      componentsForClip: () => [component],
      componentCanReceiveResponse: () => true,
      renderOverlays() {},
      updateProgress() {},
      setStatus() {},
      showControls() {},
      replaceActionRuntime() {},
      timelineById: () => harness.session.currentTimeline,
      loadClip: (...args) => harness.media.loadClip(...args),
    },
  });

  const oldSeek = harness.media.seekToElapsed(8);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.session.awaitingComponent, component);
  await transitions.restartExperience(false);
  assert.equal(harness.video.currentTime, 0);
  finishDispatch();
  await oldSeek;

  assert.equal(harness.video.currentTime, 0);
  assert.equal(harness.session.awaitingComponent, null);
});

test("a newer scrub wins when an older cross-clip seek finishes loading later", async () => {
  const session = createPlaybackSession();
  session.captureMode = true;
  session.manifest = { components: [] };
  session.currentTimeline = {
    id: "main",
    clips: [
      { id: "one", asset_id: "one", scene: "main", start: 0, end: 5 },
      { id: "two", asset_id: "two", scene: "main", start: 0, end: 5 },
    ],
  };
  session.assets = new Map([
    ["one", {}],
    ["two", {}],
  ]);
  session.assetUrls = new Map([
    ["one", "blob:one"],
    ["two", "blob:two"],
  ]);
  const listeners = new Map();
  const video = {
    currentTime: 2,
    paused: true,
    dataset: { assetId: "one" },
    pause() {},
    play: async () => {},
    load() {},
    addEventListener(name, listener) {
      const entries = listeners.get(name) || new Set();
      entries.add(listener);
      listeners.set(name, entries);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
  };
  const clipAtElapsedTime = (value) =>
    value < 5
      ? { index: 0, local: value, elapsed: value }
      : { index: 1, local: value - 5, elapsed: value };
  const media = createVideoController({
    session,
    refs: { video },
    adapters: {
      elapsedTime: () => 2,
      clipAtElapsedTime,
      activeClip: () => session.currentTimeline.clips[session.currentClipIndex],
      updateTimelineLabel() {},
      renderOverlays() {},
      updateProgress() {},
      setStatus() {},
      showControls() {},
      finishExperience() {},
      replaceActionRuntime() {},
      componentCanReceiveResponse: () => true,
      dispatchCapturedResponse() {},
    },
  });

  const older = media.seekToElapsed(8);
  const newer = media.seekToElapsed(2);
  for (const listener of [...(listeners.get("loadedmetadata") || [])])
    listener();
  await Promise.all([older, newer]);

  assert.equal(session.currentClipIndex, 0);
  assert.equal(video.currentTime, 2);
});
