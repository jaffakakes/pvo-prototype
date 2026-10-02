import assert from "node:assert/strict";
import test from "node:test";
import { createComponentQueries } from "../player/components/visibility.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createPlaybackTransitions } from "../player/playback/transitions.js";
import { evaluateAnimation, videoCoversPoint } from "../packages/pvo-animation/index.js";

const key = (time, value) => ({ time, value, easing: "linear" });
function harness({ animation, videoAnimation, below = false, response } = {}) {
  const component = { id: "choice", kind: "choice", presentation: { scene: "main", start: 1, end: 5 },
    response_policy: { dispatch: "layer_end", unanswered: "pause" },
    restyle_capture: { x: 50, y: 50, at: 1, ...(animation ? { animation } : {}) } };
  const session = createPlaybackSession();
  const clip = { scene: "main", start: 0, end: 10 };
  session.captureMode = true;
  session.currentTimeline = { id: "main", clips: [clip] };
  session.manifest = { canvas: { width: 1080, height: 1920 }, components: [component], restyle_capture: { scene_layers: { main: {
    order: below ? ["component:choice", "video"] : ["video", "component:choice"],
    clips: [{ id: 1, start: 0, in: 0, out: 10, speed: 1, animation: videoAnimation }],
  } } } };
  if (response) session.capturedResponses.set("choice", response);
  let time = 4;
  let dispatched = 0;
  const video = { paused: false, currentTime: 5, pause() { this.paused = true; }, async play() { this.paused = false; } };
  const queries = createComponentQueries({ session, adapters: { activeClip: () => clip, elapsedTime: () => time } });
  const transitions = createPlaybackTransitions({ session, refs: { video }, adapters: {
    ...queries, activeClip: () => clip, elapsedTime: () => time, renderOverlays() {}, updateProgress() {},
    setStatus() {}, showControls() {}, dispatchCapturedResponse() { dispatched++; },
  } });
  return { component, session, queries, transitions, video, setTime(value) { time = value; }, dispatched: () => dispatched };
}

test("player holds only visible animated components, while keeping timed DOM mounted during fades", () => {
  for (const [property, value] of [["opacity", 0], ["scaleX", 0], ["scaleY", 0], ["x", 100]]) {
    const item = harness({ animation: { tracks: { [property]: [key(0, property === "x" ? 0 : 1), key(4, value)] } } });
    assert.equal(item.queries.visibleComponents().length, 1, "Do not unmount forms merely because their animation moves or fades");
    assert.equal(item.queries.componentCanReceiveResponse(item.component, 5), false);
    item.setTime(5);
    assert.equal(item.transitions.handleResponseBoundary(), false, property);
    assert.equal(item.session.awaitingComponent, null, property);
    assert.equal(item.video.paused, false, property);
  }
});

test("player detects animated video revealing a lower component at its exact response boundary", () => {
  const blocked = harness({ below: true });
  assert.equal(blocked.queries.componentCanReceiveResponse(blocked.component, 5), false);
  for (const [property, value] of [["opacity", 0], ["x", 100], ["scaleX", 0]]) {
    const item = harness({ below: true, videoAnimation: { tracks: { [property]: [key(0, property === "x" ? 0 : 1), key(5, value)] } } });
    item.setTime(5);
    assert.equal(item.transitions.handleResponseBoundary(), true, property);
    assert.equal(item.session.awaitingComponent?.id, "choice", property);
  }
  const answered = harness({ animation: { tracks: { opacity: [key(0, 1), key(4, 0)] } }, response: { status: "captured" } });
  answered.setTime(5);
  assert.equal(answered.transitions.handleResponseBoundary(), true, "A captured answer still dispatches its authored layer-end action");
  assert.equal(answered.dispatched(), 1);
});

test("video occlusion uses the rotated center transform and actual canvas aspect ratio", () => {
  const motion = evaluateAnimation({ tracks: { rotation: [key(0, 90)] } }, 0);
  assert.equal(videoCoversPoint(motion, { x: 50, y: 50 }, 16 / 9), true);
  assert.equal(videoCoversPoint(motion, { x: 95, y: 50 }, 16 / 9), false);
  assert.equal(videoCoversPoint({ ...motion, opacity: 0.5 }, { x: 50, y: 50 }, 16 / 9), false);
});

test("a failed deferred response releases its hold if animation has made retry impossible", async () => {
  const item = harness({ animation: { tracks: { opacity: [key(0, 1), key(4, 0)] } }, response: { status: "failed" } });
  item.setTime(5);
  item.session.awaitingComponent = item.component;
  item.video.paused = true;
  item.transitions.releaseUnavailableResponse(item.component);
  await Promise.resolve();
  assert.equal(item.session.awaitingComponent, null);
  assert.equal(item.video.paused, false);
  assert.equal(item.session.capturedResponses.get("choice").status, "failed", "Failure is retained, not relabeled as success");
});
