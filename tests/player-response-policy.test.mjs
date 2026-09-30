import assert from "node:assert/strict";
import test from "node:test";
import { createPvoRuntime } from "../packages/pvo-sdk/index.js";
import { createComponentActions } from "../player/actions/components.js";
import { beginActionOperation, invalidateActionOperations } from "../player/actions/operations.js";
import { createOutcomeRouter } from "../player/actions/outcomes.js";
import { createActionRuntimeAdapter } from "../player/actions/runtime.js";
import { createOverlayRenderer } from "../player/components/overlays.js";
import { componentWithRuntimeState } from "../player/components/state.js";
import { createVideoController } from "../player/media/video.js";
import { createPlaybackSession } from "../player/playback/session.js";
import { createTimelineReader } from "../player/playback/timeline.js";
import { createPlaybackTransitions } from "../player/playback/transitions.js";

function controlledRuntime() {
  const listeners = new Set();
  const executions = [];
  const waits = [];
  const runtime = {
    state: {},
    visible: new Set(),
    setState(key, value) {
      this.state[key] = value;
      listeners.forEach((listener) => listener({ type: "state" }));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    execute(action, context) {
      executions.push({ action, context });
      return new Promise((resolve) => waits.push(() => {
        context.playerInteraction.outcome = { kind: "continue" };
        resolve(true);
      }));
    },
  };
  return { runtime, executions, resolveNext: () => waits.shift()?.() };
}

function choice(policy = { dispatch: "layer_end", unanswered: "continue" }) {
  return {
    id: "choice",
    kind: "choice",
    title: "Choose",
    response_policy: policy,
    presentation: { scene: "main", start: 1, end: 5 },
    options: [
      { label: "First", action: { type: "custom", name: "first" } },
      { label: "Second", action: { type: "custom", name: "second" } },
    ],
    restyle_capture: { outcomes: [{ kind: "continue" }, { kind: "continue" }] },
  };
}

function actionHarness(component, controlled = controlledRuntime()) {
  const session = createPlaybackSession();
  session.captureMode = true;
  session.manifest = { components: [component] };
  session.currentTimeline = { id: "main", clips: [{ scene: "main", start: 0, end: 10 }] };
  session.actionRuntime = controlled.runtime;
  const applied = [];
  const pending = [];
  const video = {
    paused: false,
    pause() { this.paused = true; },
    async play() { this.paused = false; },
  };
  const actions = createComponentActions({
    session,
    adapters: {
      setComponentPending(id, value) { pending.push([id, value]); },
      captureOutcome(item, index) { return item.restyle_capture.outcomes[index]; },
      async applyActionOutcome(item, index, outcome) {
        applied.push({ item, index, outcome });
        session.awaitingComponent = null;
        await video.play();
      },
      setStatus() {},
      visibleComponents: () => [component],
      renderOverlays() {},
    },
  });
  return { session, actions, controlled, applied, pending, video };
}

function transitionHarness(component, actionState) {
  let elapsed = 5;
  const { session, actions, controlled, applied, pending, video } = actionState;
  const statuses = [];
  const transitions = createPlaybackTransitions({
    session,
    refs: { video, endScreen: { hidden: true } },
    adapters: {
      elapsedTime: () => elapsed,
      localClipTime: () => elapsed,
      componentsForClip: () => [component],
      captureAboveVideo: () => true,
      renderOverlays() {},
      updateProgress() {},
      setStatus(message) { statuses.push(message); },
      showControls() {},
      activeClip: () => session.currentTimeline.clips[0],
      dispatchCapturedResponse: (id) => actions.dispatchCapturedResponse(id),
      replaceActionRuntime() {},
      timelineById: () => session.currentTimeline,
      async loadClip() {},
    },
  });
  return { session, actions, controlled, applied, pending, video, statuses, transitions, setElapsed: (value) => { elapsed = value; } };
}

test("layer-end responses stay local, latest wins, and dispatch once at the boundary", async () => {
  const component = choice();
  const harness = transitionHarness(component, actionHarness(component));

  harness.actions.answerComponent({ componentId: component.id, index: 0 });
  harness.actions.answerComponent({ componentId: component.id, index: 1 });
  assert.equal(harness.controlled.executions.length, 0, "Logic ran before the layer boundary");
  assert.equal(harness.controlled.runtime.state.choices, undefined, "Captured choice leaked into runtime state");
  assert.equal(harness.session.capturedResponses.get(component.id).index, 1, "The latest response did not replace the first");

  assert.equal(harness.transitions.handleResponseBoundary(), true);
  assert.equal(harness.video.paused, true, "Layer-end dispatch must own the async boundary");
  assert.equal(harness.controlled.executions.length, 1);
  assert.equal(harness.controlled.executions[0].action.name, "second");
  assert.equal(harness.controlled.runtime.state.choices.choice, 1);

  harness.controlled.resolveNext();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.applied.length, 1);
  assert.equal(harness.video.paused, false);
  assert.equal(harness.session.awaitingComponent, null);
  assert.equal(harness.transitions.handleResponseBoundary(), false, "A handled boundary dispatched twice");
});

test("unanswered continue and pause policies remain independent from dispatch timing", async () => {
  const optional = choice({ dispatch: "layer_end", unanswered: "continue" });
  const optionalHarness = transitionHarness(optional, actionHarness(optional));
  assert.equal(optionalHarness.transitions.handleResponseBoundary(), false);
  assert.equal(optionalHarness.video.paused, false);
  assert.equal(optionalHarness.controlled.executions.length, 0);

  const required = {
    id: "form",
    kind: "form",
    response_policy: { dispatch: "interaction", unanswered: "pause" },
    presentation: { scene: "main", start: 1, end: 5 },
    fields: [{ name: "name", type: "text" }],
    on_submit: { type: "custom", name: "save" },
    restyle_capture: { outcomes: [{ kind: "continue" }] },
  };
  const requiredHarness = transitionHarness(required, actionHarness(required));
  assert.equal(requiredHarness.transitions.handleResponseBoundary(), true);
  assert.equal(requiredHarness.video.paused, true);
  assert.equal(requiredHarness.session.awaitingComponent.id, "form");
  assert.equal(
    requiredHarness.transitions.handleResponseBoundary(),
    true,
    "A later media event must not release an unanswered boundary",
  );
  requiredHarness.transitions.advanceAtClipEnd(true);
  assert.equal(requiredHarness.session.finished, false, "An ended event must preserve the unanswered boundary");
  assert.equal(requiredHarness.session.awaitingComponent.id, "form");

  const dispatched = requiredHarness.actions.answerFieldComponent({
    componentId: "form",
    index: 0,
    fields: { name: "Ada" },
  });
  assert.deepEqual(requiredHarness.controlled.runtime.state.form.form, { name: "Ada" });
  requiredHarness.controlled.resolveNext();
  await dispatched;
  assert.equal(requiredHarness.video.paused, false);
  assert.equal(requiredHarness.session.awaitingComponent, null);
});

test("an interaction-time response satisfies pause-if-unanswered while its action is pending", async () => {
  const component = choice({ dispatch: "interaction", unanswered: "pause" });
  const harness = transitionHarness(component, actionHarness(component));

  const dispatched = harness.actions.answerComponent({ componentId: component.id, index: 0 });
  assert.equal(harness.controlled.executions.length, 1);
  assert.equal(harness.session.capturedResponses.get(component.id).status, "pending");

  assert.equal(harness.transitions.handleResponseBoundary(), false);
  assert.equal(harness.video.paused, false, "An answered interaction must not pause at the layer boundary");
  assert.equal(harness.session.handledResponses.has(component.id), true);

  harness.controlled.resolveNext();
  await dispatched;
  assert.equal(harness.applied.length, 1);
});

test("a hidden unanswered component cannot own an invisible pause boundary", () => {
  const component = choice({ dispatch: "layer_end", unanswered: "pause" });
  const harness = transitionHarness(component, actionHarness(component));
  harness.session.forcedHidden.add(component.id);
  assert.equal(harness.transitions.handleResponseBoundary(), false);
  assert.equal(harness.video.paused, false);
  assert.equal(harness.session.awaitingComponent, null);
});

test("Continue releases only the component that owns the active boundary", async () => {
  const session = createPlaybackSession();
  const owner = { id: "owner" };
  const other = { id: "other" };
  session.awaitingComponent = owner;
  const video = { paused: true, async play() { this.paused = false; } };
  const router = createOutcomeRouter({
    session,
    refs: { video },
    adapters: { renderOverlays() {}, showControls() {} },
  });
  await router.applyActionOutcome(other, 0, { kind: "continue" });
  assert.equal(session.awaitingComponent, owner);
  assert.equal(video.paused, true);
  await router.applyActionOutcome(owner, 0, { kind: "continue" });
  assert.equal(session.awaitingComponent, null);
  assert.equal(video.paused, false);
});

test("forward seek dispatches crossed deferred work and rewind re-arms its boundary", async () => {
  const component = choice({ dispatch: "layer_end", unanswered: "pause" });
  component.presentation = { scene: "main", start: 1, end: 5, x: .1, y: .1, width: .5, height: .3 };
  const session = createPlaybackSession();
  session.captureMode = true;
  session.manifest = { components: [component] };
  session.currentTimeline = { id: "main", clips: [{ id: "clip", asset_id: "video", scene: "main", start: 0, end: 10 }] };
  session.actionRuntime = {};
  session.capturedResponses.set(component.id, { componentId: component.id, index: 0, status: "pending" });
  beginActionOperation(session, component.id);
  const video = {
    currentTime: 3,
    paused: false,
    dataset: {},
    pause() { this.paused = true; },
    async play() { this.paused = false; },
  };
  const timeline = createTimelineReader({ session, readMediaTime: () => video.currentTime });
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
      setStatus(message) { statuses.push(message); },
      showControls() {},
      replaceActionRuntime() {},
      async dispatchCapturedResponse(id) {
        dispatched.push(id);
        session.capturedResponses.get(id).status = "complete";
        session.awaitingComponent = null;
      },
      captureAboveVideo: () => true,
    },
  });

  await media.seekToElapsed(8, false);
  assert.deepEqual(dispatched, [component.id]);
  assert.equal(video.currentTime, 8);
  assert.equal(session.handledResponses.has(component.id), true);
  assert.equal(session.pendingComponents.size, 0);
  assert.equal(statuses.includes(""), true, "Cancelling the old request must clear its status");

  await media.seekToElapsed(3, false);
  assert.equal(session.capturedResponses.has(component.id), false);
  assert.equal(session.handledResponses.has(component.id), false);
  video.currentTime = 5;
  const transitions = createPlaybackTransitions({
    session,
    refs: { video, endScreen: { hidden: true } },
    adapters: {
      ...timeline,
      componentsForClip: () => [component],
      captureAboveVideo: () => true,
      renderOverlays() {}, updateProgress() {}, setStatus() {}, showControls() {},
      dispatchCapturedResponse() {}, replaceActionRuntime() {}, async loadClip() {},
    },
  });
  assert.equal(transitions.handleResponseBoundary(), true);
  assert.equal(session.awaitingComponent.id, component.id);
});

test("Card buttons use the same response policy and preserve the selected action", async () => {
  const component = {
    id: "card",
    kind: "card",
    response_policy: { dispatch: "interaction", unanswered: "continue" },
    presentation: { scene: "main", start: 1, end: 5 },
    actions: [
      { label: "First", action: { type: "custom", name: "first" } },
      { label: "Second", action: { type: "custom", name: "second" } },
    ],
    restyle_capture: { outcomes: [{ kind: "continue" }, { kind: "continue" }] },
  };
  const harness = actionHarness(component);
  const dispatched = harness.actions.answerComponent({ componentId: "card", index: 1 });
  assert.equal(harness.controlled.executions[0].action.name, "second");
  harness.controlled.resolveNext();
  await dispatched;
  assert.equal(harness.applied[0].index, 1);
});

test("a stale operation cannot route or clear a newer response after session replacement", async () => {
  const component = choice({ dispatch: "interaction", unanswered: "continue" });
  const first = controlledRuntime();
  const harness = actionHarness(component, first);
  const firstRun = harness.actions.answerComponent({ componentId: "choice", index: 0 });
  assert.equal(harness.session.pendingComponents.has("choice"), true);

  invalidateActionOperations(harness.session);
  const second = controlledRuntime();
  harness.session.actionRuntime = second.runtime;
  const secondRun = harness.actions.answerComponent({ componentId: "choice", index: 1 });
  assert.equal(harness.session.pendingComponents.has("choice"), true);

  first.resolveNext();
  await firstRun;
  assert.equal(harness.applied.length, 0, "The stale response applied a playback outcome");
  assert.equal(harness.session.pendingComponents.has("choice"), true, "Stale cleanup cleared the newer operation");
  assert.equal(harness.session.capturedResponses.get("choice").index, 1);

  second.resolveNext();
  await secondRun;
  assert.equal(harness.applied.length, 1);
  assert.equal(harness.applied[0].index, 1);
  assert.equal(harness.session.pendingComponents.has("choice"), false);
});

test("native component copy resolves request-backed runtime state without mutating the manifest", () => {
  const note = { id: "note", kind: "tooltip", text: "Answer: {state.responses.choice.answer}" };
  const displayed = componentWithRuntimeState(note, { responses: { choice: { answer: "Dublin" } } });
  assert.equal(displayed.text, "Answer: Dublin");
  assert.equal(note.text, "Answer: {state.responses.choice.answer}");
  const card = { id: "card", kind: "card", title: "{state.responses.choice.answer}" };
  assert.equal(componentWithRuntimeState(card, { responses: { choice: { answer: "Dublin" } } }), card,
    "Runtime presentation templates are a display-only Note contract");
});

test("only the current runtime publishes targeted state updates", () => {
  const session = createPlaybackSession();
  session.manifest = {
    spec_version: "0.1-prototype",
    scenes: [{ id: "main", start: 0, end: 1 }],
    components: [{ id: "note", kind: "tooltip", text: "{state.answer}" }],
  };
  let renders = 0;
  const states = [];
  const adapter = createActionRuntimeAdapter({
    session,
    refs: { frame: { dispatchEvent() {} } },
    adapters: {
      renderOverlays() { renders += 1; },
      updateRuntimeState(state) { states.push(structuredClone(state)); },
      activeClip: () => null,
      elapsedTime: () => 0,
      setStatus() {},
    },
  });
  const first = adapter.makeActionRuntime(session.manifest);
  session.actionRuntime = first;
  first.setState("answer", "first");
  assert.equal(renders, 0);
  assert.deepEqual(states, [{ answer: "first" }]);
  assert.equal(session.runtimeStateRevision, 0);

  const second = adapter.replaceActionRuntime(true);
  assert.equal(second.state.answer, "first");
  first.setState("answer", "stale");
  assert.equal(states.length, 1, "A replaced runtime triggered a visible update");
  second.setState("answer", "current");
  assert.equal(renders, 0);
  assert.deepEqual(states.at(-1), { answer: "current" });
  assert.equal(session.runtimeStateRevision, 1);
});

test("state updates refresh only mounted Notes and preserve Forms", () => {
  const session = createPlaybackSession();
  const customNote = { id: "custom-note", kind: "tooltip", text: "{state.answer}" };
  const customForm = { id: "custom-form", kind: "form" };
  const nativeNote = { id: "native-note", kind: "tooltip", text: "Answer: {state.answer}" };
  const nativeForm = { id: "native-form", kind: "form" };
  session.manifest = { components: [customNote, customForm, nativeNote, nativeForm] };
  session.captureMode = true;
  const customUpdates = [];
  const formCustomUpdates = [];
  session.mountedCustom.set(customNote.id, { update(value) { customUpdates.push(value); } });
  session.mountedCustom.set(customForm.id, { update(value) { formCustomUpdates.push(value); } });
  const noteViewUpdates = [];
  const formViewUpdates = [];
  const noteView = { componentId: nativeNote.id, update(...args) { noteViewUpdates.push(args); } };
  const formView = { componentId: nativeForm.id, update(...args) { formViewUpdates.push(args); } };
  const renderer = createOverlayRenderer({
    session,
    refs: {
      frame: { clientWidth: 247 },
      overlay: { querySelectorAll: () => [noteView, formView] },
      video: {},
    },
    adapters: {},
  });

  const state = { answer: "Dublin" };
  renderer.updateRuntimeState(state);
  assert.deepEqual(customUpdates, [{ state }]);
  assert.deepEqual(formCustomUpdates, []);
  assert.equal(noteViewUpdates.length, 1);
  assert.equal(noteViewUpdates[0][0].text, "Answer: Dublin");
  assert.deepEqual(formViewUpdates, []);
});
