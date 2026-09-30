import assert from "node:assert/strict";
import test from "node:test";
import { createComponentActions } from "../player/actions/components.js";
import { createOutcomeRouter } from "../player/actions/outcomes.js";
import { createActionRuntimeAdapter } from "../player/actions/runtime.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createPlaybackTransitions } from "../player/playback/transitions.js";

const presentation = { scene: "main", start: 1, end: 5, x: .1, y: .1, width: .5, height: .3 };

function request(url, { onError, onSuccess, into } = {}) {
  return {
    type: "request",
    method: "GET",
    url,
    ...(into ? { into } : {}),
    ...(onSuccess ? { on_success: onSuccess } : {}),
    ...(onError !== undefined ? { on_error: onError } : {}),
  };
}

function requestChoice(id, firstAction) {
  return {
    id,
    kind: "choice",
    presentation,
    response_policy: { dispatch: "interaction", unanswered: "continue" },
    options: [
      { label: "Send", ...(Array.isArray(firstAction) ? { actions: firstAction } : { action: firstAction }) },
      { label: "Continue", action: { type: "custom", name: "restyle_continue" } },
    ],
  };
}

function playerHarness(components) {
  const main = { id: "main", clips: [{ id: "main-clip", asset_id: "main-video", scene: "main", start: 0, end: 10 }] };
  const target = { id: "target", clips: [{ id: "target-clip", asset_id: "target-video", scene: "target", start: 0, end: 3 }] };
  const manifest = {
    spec_version: "0.1-prototype",
    allowed_domains: ["example.test"],
    media: [
      { id: "main-video", asset_id: "main-video" },
      { id: "target-video", asset_id: "target-video" },
    ],
    scenes: [
      { id: "main", asset_id: "main-video", start: 0, end: 10 },
      { id: "target", asset_id: "target-video", start: 0, end: 3 },
    ],
    components,
    playback: { initial_timeline: "main", timelines: [main, target] },
  };
  const session = createPlaybackSession();
  session.captureMode = true;
  session.manifest = manifest;
  session.currentTimeline = main;
  const video = {
    currentTime: 4,
    paused: false,
    pause() { this.paused = true; },
    async play() { this.paused = false; },
  };
  const endScreen = { hidden: true };
  const statuses = [];
  const applied = [];
  const loaded = [];
  let runtimeAdapter;
  const router = createOutcomeRouter({
    session,
    refs: { video, endScreen },
    adapters: {
      captureTimelineForScene: (sceneId) => [main, target].find((timeline) =>
        timeline.clips.some((clip) => clip.scene === sceneId)) || null,
      renderOverlays() {},
      async loadClip(index, autoplay) { loaded.push({ timeline: session.currentTimeline.id, index, autoplay }); },
      async seekToElapsed() {},
      showControls() {},
      replaceActionRuntime: (...args) => runtimeAdapter.replaceActionRuntime(...args),
      setStatus(message, error) { statuses.push({ message, error }); },
    },
  });
  runtimeAdapter = createActionRuntimeAdapter({
    session,
    refs: { frame: { dispatchEvent() {} } },
    adapters: {
      renderOverlays() {}, updateRuntimeState() {}, activeClip: () => main.clips[0], elapsedTime: () => 4,
      setStatus(message, error) { statuses.push({ message, error }); },
    },
  });
  session.actionRuntime = runtimeAdapter.makeActionRuntime(manifest);
  const actions = createComponentActions({
    session,
    adapters: {
      setComponentPending() {}, updateComponentResponse() {}, renderOverlays() {},
      setStatus(message, error) { statuses.push({ message, error }); },
      visibleComponents: () => components,
      captureOutcome: () => ({ kind: "continue" }),
      async applyActionOutcome(component, index, outcome) {
        applied.push({ component: component.id, index, outcome });
        await router.applyActionOutcome(component, index, outcome);
      },
    },
  });
  const transitions = createPlaybackTransitions({
    session,
    refs: { video, endScreen },
    adapters: {
      elapsedTime: () => 10, localClipTime: () => 10, activeClip: () => main.clips[0],
      componentsForClip: () => components, captureAboveVideo: () => true,
      renderOverlays() {}, updateProgress() {}, showControls() {},
      setStatus(message, error) { statuses.push({ message, error }); },
      replaceActionRuntime: (...args) => runtimeAdapter.replaceActionRuntime(...args),
      timelineById: (id) => [main, target].find((timeline) => timeline.id === id) || null,
      async loadClip(index, autoplay) { loaded.push({ timeline: session.currentTimeline.id, index, autoplay }); },
      dispatchCapturedResponse: (id) => actions.dispatchCapturedResponse(id),
    },
  });
  return { session, actions, transitions, video, endScreen, statuses, applied, loaded };
}

test("concurrent requests keep their component identity and preserve an unhandled failure status", async (t) => {
  const pending = new Map();
  t.mock.method(globalThis, "fetch", (url) => new Promise((resolve, reject) => {
    pending.set(String(url), { resolve, reject });
  }));
  const first = requestChoice("first", request("https://example.test/first", { into: "responses.first" }));
  const second = requestChoice("second", request("https://example.test/second", { into: "responses.second" }));
  const harness = playerHarness([first, second]);

  const firstRun = harness.actions.answerComponent({ componentId: first.id, index: 0 });
  const secondRun = harness.actions.answerComponent({ componentId: second.id, index: 0 });
  pending.get("https://example.test/first").reject(new Error("offline"));
  await new Promise((resolve) => setImmediate(resolve));
  pending.get("https://example.test/second").resolve(new Response('{"ok":true}', {
    headers: { "Content-Type": "application/json" },
  }));
  await Promise.all([firstRun, secondRun]);

  assert.equal(harness.session.capturedResponses.get(first.id).status, "failed");
  assert.equal(harness.session.capturedResponses.get(second.id).status, "complete");
  assert.deepEqual(harness.session.actionRuntime.state.choices, { first: 0, second: 0 });
  assert.deepEqual(harness.session.actionRuntime.state.responses.second, { ok: true });
  assert.deepEqual(harness.applied.map((item) => item.component), [second.id]);
  assert.equal(harness.statuses.at(-1).message, "Request unavailable");

  await harness.actions.answerComponent({ componentId: first.id, index: 1 });
  assert.equal(harness.session.capturedResponses.get(first.id).status, "complete");
  assert.equal(harness.statuses.at(-1).message, "");
});

test("a handled request error runs its state action and defaults to Continue", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const component = requestChoice("handled", request("https://example.test/handled", {
    onError: { type: "set", key: "request_error", value: true },
  }));
  const harness = playerHarness([component]);

  await harness.actions.answerComponent({ componentId: component.id, index: 0 });

  assert.equal(harness.session.actionRuntime.state.request_error, true);
  assert.equal(harness.session.capturedResponses.get(component.id).status, "complete");
  assert.equal(harness.applied.length, 1);
  assert.deepEqual(harness.applied[0].outcome, { kind: "continue" });
  assert.equal(harness.statuses.at(-1).message, "");
});

test("one unhandled failure stays failed even if a later request error is handled", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const component = requestChoice("ordered", [
    request("https://example.test/first"),
    request("https://example.test/second", { onError: { type: "set", key: "second_handled", value: true } }),
  ]);
  const harness = playerHarness([component]);

  await harness.actions.answerComponent({ componentId: component.id, index: 0 });

  assert.equal(harness.session.actionRuntime.state.second_handled, true);
  assert.equal(harness.session.capturedResponses.get(component.id).status, "failed");
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.statuses.at(-1).message, "Request unavailable");
});

test("a failed success action still settles the completed network request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"ok":true}', {
    headers: { "Content-Type": "application/json" },
  }));
  const component = requestChoice("broken-success", request("https://example.test/success", {
    onSuccess: { type: "set", key: "responses.__proto__.polluted", value: true },
  }));
  const harness = playerHarness([component]);

  await harness.actions.answerComponent({ componentId: component.id, index: 0 });

  assert.equal(harness.session.capturedResponses.get(component.id).status, "failed");
  assert.equal(harness.session.pendingRequestComponents.size, 0);
  assert.equal(harness.statuses.some(({ message }) => message === "Connecting…"), true);
  assert.match(harness.statuses.at(-1).message, /reserved key/);
});

test("an interaction request may finish after the final frame and still open its success scene", async (t) => {
  let respond;
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { respond = resolve; }));
  const component = requestChoice("terminal", request("https://example.test/terminal", {
    onSuccess: { type: "goto_scene", scene: "target" },
    into: "responses.terminal",
  }));
  const harness = playerHarness([component]);

  const pending = harness.actions.answerComponent({ componentId: component.id, index: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  harness.transitions.finishExperience();
  assert.equal(harness.session.finished, true);
  assert.equal(harness.endScreen.hidden, false);
  assert.equal(harness.statuses.at(-1).message, "Connecting…");

  respond(new Response('{"next":"target"}', { headers: { "Content-Type": "application/json" } }));
  await pending;

  assert.equal(harness.session.finished, false);
  assert.equal(harness.endScreen.hidden, true);
  assert.equal(harness.session.currentTimeline.id, "target");
  assert.deepEqual(harness.loaded.at(-1), { timeline: "target", index: 0, autoplay: true });
});
