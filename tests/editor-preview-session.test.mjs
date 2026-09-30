import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `export { createTrySession } from './editor/src/features/preview/createTrySession.ts';
    export { initial } from './editor/src/state/project/initial.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { createTrySession, initial } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function fixture(time, request = async () => new Response("{}"), component = {
  id: "card", type: "card", at: 5, dur: null,
  responsePolicy: { dispatch: "interaction", unanswered: "continue" }, fields: {},
}, { allowStartFailure = false } = {}) {
  const state = initial();
  state.t = time;
  state.clips = [{ id: 1, in: 0, out: 10, srcDur: 10, speed: 1 }];
  state.components = [component];
  state.scenes = [
    { ...state.scenes[0], clips: state.clips, components: state.components },
  ];
  state.allowedDomains = ["example.com"];
  state.patch = (values) => Object.assign(state, values);
  let feedback = {};
  let runtimeState = null;
  const runtimeHistory = [];
  let serial = 0;
  let startFailures = 0;
  const session = createTrySession({
    getState: () => state,
    request,
    publishRuntimeState(value) {
      runtimeState = value;
      runtimeHistory.push(value == null ? null : structuredClone(value));
    },
    feedback: () => feedback,
    clearFeedback: () => {
      feedback = {};
    },
    clearNotice() {},
    startFailed() {
      startFailures += 1;
      if (!allowStartFailure) assert.fail("Preview should start");
    },
    emptyScene() {},
    beginRequest(id) {
      const operation = ++serial;
      feedback[id] = { operation, phase: "pending" };
      return operation;
    },
    finishRequest(id, operation, failed) {
      if (feedback[id]?.operation !== operation) return;
      if (failed) feedback[id].phase = "failed";
      else delete feedback[id];
    },
  });
  return {
    state,
    session,
    feedback: () => feedback,
    runtimeState: () => runtimeState,
    runtimeHistory,
    startFailures: () => startFailures,
  };
}

test("Try rejects a buttonless pausing Message in any scene", () => {
  const active = {
    id: "active-message", type: "card", sceneId: "main", at: 1, dur: 2,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    fields: { buttons: [] },
  };
  const harness = fixture(1, undefined, active, { allowStartFailure: true });
  const inactiveClip = { ...harness.state.clips[0], id: 2 };
  const inactiveMessage = {
    id: "inactive-message", type: "card", sceneId: "branch", at: 1, dur: 2,
    responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
    fields: { buttons: [] },
  };
  harness.state.scenes.push({
    ...harness.state.scenes[0],
    id: "branch",
    name: "Branch",
    clips: [inactiveClip],
    components: [inactiveMessage],
  });

  harness.session.startTry();

  assert.equal(harness.startFailures(), 1);
  assert.equal(harness.state.tryMode, null);
  assert.equal(harness.session.getTryRuntime(), null);
});

test("preview sessions retain independent runtimes and restore their own editing positions", () => {
  const first = fixture(1);
  const second = fixture(3);
  first.session.startTry();
  second.session.startTry();
  assert.notEqual(
    first.session.getTryRuntime(),
    second.session.getTryRuntime(),
  );
  first.state.t = 8;
  second.state.t = 9;
  first.session.stopTry();
  assert.equal(first.state.t, 1);
  assert.equal(first.session.getTryRuntime(), null);
  assert(second.session.getTryRuntime());
  assert(second.state.tryMode);
  second.session.stopTry();
  assert.equal(second.state.t, 3);
});

test("a late request response cannot resume a stopped preview or restore cleared feedback", async () => {
  let respond;
  let started;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  const { session, state, feedback, runtimeState } = fixture(2, async () => {
    started();
    return new Promise((resolve) => {
      respond = resolve;
    });
  });
  session.startTry();
  const pending = session.runComponentResponse(state.components[0], { index: 0, outcome: {
    kind: "request", url: "https://example.com/save", method: "GET",
    onSuccess: { kind: "continue" }, onError: null,
  } });
  await requested;
  assert.equal(feedback().card.phase, "pending");
  session.stopTry();
  assert.equal(runtimeState(), null);
  respond(
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  await pending;
  assert.equal(state.t, 2);
  assert.equal(state.tryMode, null);
  assert.equal(state.playing, false);
  assert.deepEqual(feedback(), {});
  assert.equal(runtimeState(), null, "A stopped session must ignore late runtime state events");
});

test("an active preview publishes request response state and clears it when stopped", async () => {
  const { session, state, runtimeState } = fixture(2, async () => new Response(
    JSON.stringify({ message: "Saved" }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  session.startTry();
  assert.deepEqual(runtimeState(), {});

  await session.runComponentResponse(state.components[0], { index: 0, outcome: {
    kind: "request", url: "https://example.com/save", method: "GET",
    onSuccess: { kind: "continue" }, onError: null,
  } });

  assert.deepEqual(runtimeState(), { responses: { card: { message: "Saved" } } });
  session.stopTry();
  assert.equal(runtimeState(), null);
});

test("all four response-policy combinations keep dispatch timing separate from unanswered playback", async () => {
  const requestOutcome = {
    kind: "request", url: "https://example.com/save", method: "POST", body: "{}",
    onSuccess: { kind: "continue" }, onError: null,
  };
  for (const dispatch of ["interaction", "layer_end"])
    for (const unanswered of ["continue", "pause"]) {
      let requests = 0;
      const component = {
        id: `card-${dispatch}-${unanswered}`, type: "card", at: 2, dur: 2,
        responsePolicy: { dispatch, unanswered },
        fields: { buttons: [{ label: "Send", outcome: requestOutcome }] },
      };
      const answered = fixture(2.5, async () => {
        requests += 1;
        return new Response('{"saved":true}', { status: 200, headers: { "content-type": "application/json" } });
      }, component);
      answered.session.startTry();
      await answered.session.runComponentResponse(component, { index: 0, outcome: requestOutcome });
      assert.equal(requests, dispatch === "interaction" ? 1 : 0, `${dispatch}/${unanswered} dispatched at the wrong time`);
      answered.state.t = 3.9;
      answered.session.advanceTry(answered.state, 4.05);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests, 1, `${dispatch}/${unanswered} did not dispatch exactly once`);
      assert.equal(answered.state.playing, true, `${dispatch}/${unanswered} treated an answered response as unanswered`);
      answered.session.stopTry();

      requests = 0;
      const unansweredSession = fixture(3.9, async () => {
        requests += 1;
        return new Response("{}");
      }, component);
      unansweredSession.session.startTry();
      const consumed = unansweredSession.session.advanceTry(unansweredSession.state, 4.05);
      assert.equal(requests, 0, `${dispatch}/${unanswered} synthesized an unanswered request`);
      assert.equal(unansweredSession.state.playing, unanswered !== "pause");
      assert.equal(unansweredSession.state.tryMode.holdingId,
        unanswered === "pause" ? component.id : null);
      assert.equal(consumed, dispatch === "layer_end" || unanswered === "pause");
      unansweredSession.session.stopTry();
    }
});

test("a response supplied after an unanswered pause dispatches immediately", async () => {
  let requests = 0;
  const outcome = {
    kind: "request", url: "https://example.com/save", method: "GET",
    onSuccess: { kind: "continue" }, onError: null,
  };
  const component = {
    id: "late-card", type: "card", at: 2, dur: 2,
    responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
    fields: { buttons: [{ label: "Send", outcome }] },
  };
  const current = fixture(3.9, async () => {
    requests += 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }, component);
  current.session.startTry();
  current.session.advanceTry(current.state, 4.05);
  assert.equal(current.state.playing, false);
  await current.session.runComponentResponse(component, { index: 0, outcome });
  assert.equal(requests, 1);
  assert.equal(current.state.playing, true);
  assert.equal(current.state.tryMode.holdingId, null);
  current.session.stopTry();
});

test("a failed layer-end route stays retryable at its boundary", async () => {
  const component = {
    id: "route-card", type: "card", sceneId: "main", at: 2, dur: 2,
    responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
    fields: { buttons: [{ label: "Missing", outcome: { kind: "scene", sceneId: "missing" } }] },
  };
  const current = fixture(2.5, undefined, component);
  current.session.startTry();
  await current.session.runComponentResponse(component, {
    index: 0,
    outcome: { kind: "scene", sceneId: "missing" },
  });
  current.state.t = 3.9;
  current.session.advanceTry(current.state, 4.05);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(current.state.tryMode.holdingId, component.id);
  assert.equal(current.state.tryMode.dispatched.includes(component.id), false);
  assert.equal(current.state.tryMode.capturedResponses[component.id].index, 0);

  await current.session.runComponentResponse(component, {
    index: 0,
    outcome: { kind: "continue" },
  });
  assert.equal(current.state.tryMode.holdingId, null);
  assert.equal(current.state.playing, true);
  current.session.stopTry();
});

test("a failed interaction still counts as answered for pause-if-nobody-responds", async () => {
  const component = {
    id: "answered-failure", type: "choice", sceneId: "main", at: 2, dur: 2,
    responsePolicy: { dispatch: "interaction", unanswered: "pause" },
    fields: { options: [
      { label: "Send", outcome: { kind: "continue" } },
      { label: "Skip", outcome: { kind: "continue" } },
    ] },
  };
  const harness = fixture(2.5, async () => { throw new Error("offline"); }, component);
  harness.session.startTry();
  await harness.session.runComponentResponse(component, {
    index: 0,
    outcome: {
      kind: "request", method: "GET", url: "https://example.com/result", body: "",
      onSuccess: { kind: "continue" }, onError: null,
    },
  });
  assert(harness.state.tryMode.capturedResponses[component.id]);
  assert.equal(harness.state.tryMode.dispatched.includes(component.id), false);

  harness.state.t = 3.9;
  harness.session.advanceTry(harness.state, 4.05);
  assert.equal(harness.state.tryMode.holdingId, null);
  assert.equal(harness.state.playing, true);
});

test("a missing Form destination is captured first and fails only at its dispatch time", async () => {
  const form = {
    id: "deferred-form", type: "form", sceneId: "main", at: 2, dur: 2,
    responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
    fields: {
      formFields: [{ name: "Name", type: "text" }],
      formSubmitMode: "request", destination: "", failureOutcome: null,
      submitLabel: "Send",
    },
  };
  const current = fixture(2.5, undefined, form);
  current.session.startTry();
  await current.session.runFormSubmission(form, { field_1: "Ada" });
  assert.deepEqual(current.feedback(), {});
  assert.deepEqual(current.state.tryMode.capturedResponses[form.id].formValues, { field_1: "Ada" });

  current.state.t = 3.9;
  current.session.advanceTry(current.state, 4.05);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.feedback()[form.id].phase, "failed");
  assert.equal(current.state.tryMode.holdingId, form.id);
  assert.equal(current.state.tryMode.dispatched.includes(form.id), false);
  current.session.stopTry();

  const routed = structuredClone(form);
  routed.id = "routed-form";
  routed.fields.failureOutcome = { kind: "time", t: 1 };
  const routedSession = fixture(2.5, undefined, routed);
  routedSession.session.startTry();
  await routedSession.session.runFormSubmission(routed, { field_1: "Ada" });
  assert.equal(routedSession.state.t, 2.5, "The failure route must not run at interaction time");
  routedSession.state.t = 3.9;
  routedSession.session.advanceTry(routedSession.state, 4.05);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(routedSession.state.t, 1);
  assert.equal(routedSession.state.playing, true);
  routedSession.session.stopTry();
});

test("a seek from one request cancels another request and clears its pending feedback", async () => {
  const first = {
    id: "first", type: "card", at: 1, dur: 5,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" }, fields: {},
  };
  const second = {
    id: "second", type: "card", at: 1, dur: 5,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" }, fields: {},
  };
  const releases = new Map();
  const current = fixture(2, (url) => new Promise((resolve) => {
    releases.set(String(url), resolve);
  }), first);
  current.state.components = [first, second];
  current.state.scenes[0].components = current.state.components;
  current.session.startTry();

  const firstRun = current.session.runComponentResponse(first, { index: 0, outcome: {
    kind: "request", url: "https://example.com/first", method: "GET",
    onSuccess: { kind: "time", t: 6 }, onError: null,
  } });
  const secondRun = current.session.runComponentResponse(second, { index: 0, outcome: {
    kind: "request", url: "https://example.com/second", method: "GET",
    onSuccess: { kind: "continue" }, onError: null,
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.feedback().first.phase, "pending");
  assert.equal(current.feedback().second.phase, "pending");

  releases.get("https://example.com/first")(new Response("{}", {
    status: 200, headers: { "content-type": "application/json" },
  }));
  await firstRun;
  assert.equal(current.state.t, 6);
  assert.equal(current.feedback().second, undefined);

  releases.get("https://example.com/second")(new Response("{}", {
    status: 200, headers: { "content-type": "application/json" },
  }));
  await secondRun;
  assert.equal(current.feedback().second, undefined);
  current.session.stopTry();
});

test("Try lets an interaction request finish at the final frame before ending", async () => {
  let respond;
  const response = new Promise((resolve) => { respond = resolve; });
  const component = {
    id: "last-request", type: "choice", sceneId: "main", at: 8, dur: 2,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    fields: { options: [
      { label: "Send", outcome: { kind: "continue" } },
      { label: "Skip", outcome: { kind: "continue" } },
    ] },
  };
  const harness = fixture(9.8, async () => response, component);
  harness.session.startTry();
  const pending = harness.session.runComponentResponse(component, {
    index: 0,
    outcome: {
      kind: "request", method: "GET", url: "https://example.com/result", body: "",
      onSuccess: { kind: "continue" }, onError: null,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.session.advanceTry(harness.state, 10.1), true);
  assert(harness.state.tryMode, "The active request was aborted by the scene ending");
  assert.equal(harness.state.playing, false);

  respond(new Response('{"message":"done"}', { headers: { "Content-Type": "application/json" } }));
  await pending;
  assert(harness.runtimeHistory.some((state) => state?.responses?.[component.id]?.message === "done"));
  assert.equal(harness.state.tryMode, null);
});

test("Try exits a terminal wait after an unhandled interaction request failure", async () => {
  let reject;
  const response = new Promise((_, fail) => { reject = fail; });
  const component = {
    id: "last-failure", type: "choice", sceneId: "main", at: 8, dur: 2,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    fields: { options: [
      { label: "Send", outcome: { kind: "continue" } },
      { label: "Skip", outcome: { kind: "continue" } },
    ] },
  };
  const harness = fixture(9.8, async () => response, component);
  harness.session.startTry();
  const pending = harness.session.runComponentResponse(component, {
    index: 0,
    outcome: {
      kind: "request", method: "GET", url: "https://example.com/result", body: "",
      onSuccess: { kind: "continue" }, onError: null,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.session.advanceTry(harness.state, 10.1);
  reject(new Error("offline"));
  await pending;

  assert.equal(harness.state.tryMode, null);
});
