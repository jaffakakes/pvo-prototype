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

function playerHarness(components, diagnostics = {}) {
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
  const session = createPlaybackSession(diagnostics);
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
  pending.get("https://example.test/first").reject(new TypeError("offline"));
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
  assert.equal(harness.statuses.at(-1).message, "Could not reach the service.");

  await harness.actions.answerComponent({ componentId: first.id, index: 1 });
  assert.equal(harness.session.capturedResponses.get(first.id).status, "complete");
  assert.equal(harness.statuses.at(-1).message, "");
});

test("optional player diagnostics explain deferred and duplicate input and keep request correlation", async t => {
  const events = [];
  let finish;
  let sends = 0;
  t.mock.method(globalThis, "fetch", () => {
    sends += 1;
    return new Promise(resolve => { finish = resolve; });
  });
  const component = requestChoice("question", request("https://example.test/scores"));
  component.response_policy.dispatch = "layer_end";
  const harness = playerHarness([component], { onDiagnostic(event) {
    events.push(event);
    throw new Error("Broken developer observer");
  } });
  await harness.actions.answerComponent({ componentId: component.id, index: 0 });
  assert.equal(sends, 0);
  assert.ok(events.some(event => event.type === "response.deferred" && event.reason === "layer_end"));
  const input = events.find(event => event.type === "interaction.received");
  harness.transitions.handleResponseBoundary();
  await harness.actions.answerComponent({ componentId: component.id, index: 0 });
  assert.ok(events.some(event => event.type === "interaction.ignored" && event.reason === "request_pending"));
  finish(new Response("missing", { status: 404 }));
  await new Promise(resolve => setImmediate(resolve));
  const failed = events.find(event => event.type === "request.failed");
  assert.equal(failed.status, 404);
  assert.equal(failed.interactionId, input.interactionId);
  assert.equal(sends, 1);
  assert.equal(harness.session.capturedResponses.get(component.id).status, "failed");
});

test("enabling diagnostics preserves Continue, seek, scene, deferred and request playback behavior", async t => {
  let responseStatus = 200;
  let sends = 0;
  t.mock.method(globalThis, "fetch", async () => {
    sends += 1;
    return new Response('{"score":3}', { status: responseStatus, headers: { "content-type": "application/json" } });
  });
  const cases = [
    { label: "Continue", action: { type: "custom", name: "restyle_continue" } },
    { label: "seek", action: { type: "seek", time: 3 } },
    { label: "scene", action: { type: "goto_scene", scene: "target" } },
    { label: "deferred", action: { type: "custom", name: "restyle_continue" }, deferred: true },
    { label: "request success", action: request("https://example.test/scores", { into: "scores" }), status: 200 },
    { label: "request failure", action: request("https://example.test/scores"), status: 404 },
  ];
  for (const scenario of cases) {
    const snapshots = [];
    for (const onDiagnostic of [undefined, () => {}, () => { throw new Error("Observer failed"); }]) {
      sends = 0;
      responseStatus = scenario.status ?? 200;
      const component = requestChoice("question", scenario.action);
      if (scenario.deferred) component.response_policy.dispatch = "layer_end";
      const harness = playerHarness([component], { onDiagnostic });
      await harness.actions.answerComponent({ componentId: component.id, index: 0 });
      if (scenario.deferred) harness.transitions.handleResponseBoundary();
      await new Promise(resolve => setImmediate(resolve));
      snapshots.push({
        state: harness.session.actionRuntime.state,
        responses: [...harness.session.capturedResponses].map(([id, { diagnostic, ...response }]) => [id, response]),
        holdingId: harness.session.awaitingComponent?.id,
        timeline: harness.session.currentTimeline.id,
        paused: harness.video.paused,
        time: harness.video.currentTime,
        applied: harness.applied,
        loaded: harness.loaded,
        statuses: harness.statuses,
        sends,
      });
    }
    assert.deepEqual(snapshots[1], snapshots[0], `${scenario.label}: enabling observation changed behavior`);
    assert.deepEqual(snapshots[2], snapshots[0], `${scenario.label}: an observer failure changed behavior`);
    assert.equal(snapshots[0].sends, scenario.status ? 1 : 0);
  }
});

test("a handled request error runs its state action and defaults to Continue", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline"); });
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
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline"); });
  const component = requestChoice("ordered", [
    request("https://example.test/first"),
    request("https://example.test/second", { onError: { type: "set", key: "second_handled", value: true } }),
  ]);
  const harness = playerHarness([component]);

  await harness.actions.answerComponent({ componentId: component.id, index: 0 });

  assert.equal(harness.session.actionRuntime.state.second_handled, true);
  assert.equal(harness.session.capturedResponses.get(component.id).status, "failed");
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.statuses.at(-1).message, "Could not reach the service.");
});

test("player shows the HTTP cause without treating a 404 as an offline server", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  const component = requestChoice("missing-route", request("https://example.test/missing"));
  const harness = playerHarness([component]);

  await harness.actions.answerComponent({ componentId: component.id, index: 0 });

  assert.equal(harness.session.capturedResponses.get(component.id).status, "failed");
  assert.equal(harness.statuses.at(-1).message, "Request not found (404).");
});

test("player shows a service failure while keeping the answer retryable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const component = requestChoice("service-error", request("https://example.test/unavailable"));
  const harness = playerHarness([component]);

  await harness.actions.answerComponent({ componentId: component.id, index: 0 });

  assert.equal(harness.session.capturedResponses.get(component.id).status, "failed");
  assert.equal(harness.statuses.at(-1).message, "Service error (503). Try again.");
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
