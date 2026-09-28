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

function fixture(time, request = async () => new Response("{}")) {
  const state = initial();
  state.t = time;
  state.clips = [{ id: 1, in: 0, out: 10, srcDur: 10, speed: 1 }];
  state.components = [{ id: "card", type: "card", at: 5, fields: {} }];
  state.scenes = [
    { ...state.scenes[0], clips: state.clips, components: state.components },
  ];
  state.allowedDomains = ["example.com"];
  state.patch = (values) => Object.assign(state, values);
  let feedback = {};
  let serial = 0;
  const session = createTrySession({
    getState: () => state,
    request,
    feedback: () => feedback,
    clearFeedback: () => {
      feedback = {};
    },
    clearNotice() {},
    startFailed() {
      assert.fail("Preview should start");
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
  return { state, session, feedback: () => feedback };
}

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
  const { session, state, feedback } = fixture(2, async () => {
    started();
    return new Promise((resolve) => {
      respond = resolve;
    });
  });
  session.startTry();
  const pending = session.runOutcome(state.components[0], {
    kind: "request",
    url: "https://example.com/save",
    method: "GET",
    onSuccess: { kind: "continue" },
    onError: null,
  });
  await requested;
  assert.equal(feedback().card.phase, "pending");
  session.stopTry();
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
});
