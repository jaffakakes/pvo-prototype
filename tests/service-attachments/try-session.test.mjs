import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { prepareServiceAttachmentReceipt } from "../../packages/pvo-assistant/attachments/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { create, now } from "../assistant-tasks/fixtures.mjs";
import { attachment } from "./fixtures.mjs";

const compiled = buildSync({
  stdin: {
    contents: `
  export { createTrySession } from './editor/src/features/preview/createTrySession.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { prepareComponentTest } from './editor/src/domain/components/serviceSubmission.ts';
  export { sendComponentTest } from './editor/src/infrastructure/services/componentTestTransport.ts';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { createTrySession, initial, prepareComponentTest, sendComponentTest } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
const publication = await prepareServicePublication(
  create(),
  "host-one",
  await checkedFixture(),
  now + 86400000,
);
const origin = "https://services.example";
const connection = {
  origin,
  receipt: prepareServiceAttachmentReceipt(
    publication,
    { identity: publication.identity, state: "available" },
    "join",
    now,
  ),
  connection: attachment(publication.identity.resourceId).connection,
};
const outcome = {
  kind: "request",
  url: `${origin}/api/services/${publication.identity.serviceId}/actions`,
  method: "POST",
  body: JSON.stringify({
    operation: "join",
    input: connection.connection.input,
  }),
  onSuccess: { kind: "time", t: 7 },
  onError: null,
};
const component = {
  id: "join",
  type: "form",
  sceneId: "main",
  at: 0,
  dur: null,
  responsePolicy: { dispatch: "interaction", unanswered: "pause" },
  fields: { outcome, fieldKinds: ["name"] },
  code: {
    custom: true,
    pvo: { structure: "", style: "", logic: "" },
    pvoCompiled: {
      structure: {
        type: "form",
        submit: "Join",
        fields: [{ name: "guest", kind: "name" }],
      },
      rules: [{ event: "submit", target: null, action: outcome }],
    },
  },
  serviceConnection: connection,
};
const response = (name = "Alice") => ({
  index: 0,
  outcome,
  formValues: { guest: name },
});
const scope = () => ({
  origin,
  localId: "local-one",
  ownerId: publication.identity.ownerId,
  assistantTaskLinks: {
    localId: "local-one",
    accounts: [
      {
        ownerId: publication.identity.ownerId,
        projectId: publication.identity.projectId,
        taskId: publication.identity.taskId,
      },
    ],
  },
});
function storage() {
  const records = new Map();
  let chain = Promise.resolve(),
    closed = 0;
  return {
    records,
    get closed() {
      return closed;
    },
    async open() {
      return {
        read: async (key) => structuredClone(records.get(key) ?? null),
        update(key, change) {
          const next = chain.then(() => {
            const value = change(structuredClone(records.get(key) ?? null));
            records.set(key, structuredClone(value));
            return structuredClone(value);
          });
          chain = next.catch(() => {});
          return next;
        },
        close() {
          closed++;
        },
      };
    },
  };
}
function fixture({
  store = storage(),
  send = async (_url, options) =>
    Response.json({
      actionId: JSON.parse(options.body).actionId,
      result: "accepted",
    }),
  openStore = () => store.open(),
} = {}) {
  const state = initial();
  const account = scope();
  const item = structuredClone(component);
  Object.assign(state, {
    localId: account.localId,
    currentSceneId: "main",
    t: 0,
    clips: [{ id: 1, in: 0, out: 10, srcDur: 10, speed: 1 }],
    components: [item],
    allowedDomains: [new URL(origin).host],
  });
  state.scenes = [
    {
      ...state.scenes[0],
      id: "main",
      clips: state.clips,
      components: state.components,
    },
  ];
  state.patch = (values) => Object.assign(state, values);
  let feedback = {},
    serial = 0,
    ordinary = 0;
  const session = createTrySession({
    getState: () => state,
    services: {
      scope: () => account,
      openStore,
      createId: () => crypto.randomUUID(),
      request: send,
    },
    request: async () => {
      ordinary++;
      return Response.json({ ordinary: true });
    },
    publishRuntimeState() {},
    feedback: () => feedback,
    clearFeedback() {
      feedback = {};
    },
    clearNotice() {},
    startFailed() {
      assert.fail("Try must start");
    },
    playbackFailed() {
      assert.fail("Try must play");
    },
    emptyScene() {},
    beginRequest(id) {
      const operation = ++serial;
      feedback[id] = { phase: "pending", operation };
      return operation;
    },
    finishRequest(id, operation, failed, failure) {
      if (feedback[id]?.operation !== operation) return;
      if (failed) feedback[id] = { phase: "failed", operation, failure };
      else delete feedback[id];
    },
  });
  session.startTry();
  return {
    session,
    state,
    account,
    item,
    store,
    feedback: () => feedback,
    get ordinary() {
      return ordinary;
    },
    submit: (name) => session.runComponentResponse(item, response(name)),
  };
}

test("Try persists literal input before dispatch, recovers a lost reply in a new session and saves completion before routing", async () => {
  const store = storage(),
    wires = [];
  const send = async (url, options) => {
    assert.equal(store.records.size, 1, "intent committed before dispatch");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(
      url,
      `${origin}/api/services/${publication.identity.serviceId}/releases/${publication.identity.resourceId}/try`,
    );
    wires.push(options.body);
    if (wires.length === 1) throw new TypeError("Lost successful reply");
    return Response.json({
      actionId: JSON.parse(options.body).actionId,
      result: "accepted",
    });
  };
  const first = fixture({ store, send });
  await first.submit("{state.private.value}");
  assert.equal(first.feedback().join.phase, "failed");
  assert.equal(first.state.t, 0);
  assert.equal([...store.records.values()][0].response, null);
  first.session.stopTry();
  const second = fixture({ store, send });
  const patch = second.state.patch;
  second.state.patch = (values) => {
    if (values.t === 7)
      assert.equal([...store.records.values()][0].response.result, "accepted");
    patch(values);
  };
  await second.submit("{state.private.value}");
  assert.equal(wires[1], wires[0]);
  assert.deepEqual(JSON.parse(wires[0]).input, {
    name: "{state.private.value}",
  });
  assert.equal(second.state.t, 7);
  assert.deepEqual(
    second.session.getTryRuntime().state.responses.join,
    [...store.records.values()][0].response,
  );
  second.session.stopTry();
  const third = fixture({ store, send });
  await third.submit("Another guest");
  assert.notEqual(JSON.parse(wires[2]).actionId, JSON.parse(wires[1]).actionId);
  third.session.stopTry();
  assert.equal(store.closed, 3);
  assert.equal(first.ordinary + second.ordinary + third.ordinary, 0);
});

test("Try refuses changed connections, foreign owners/projects/origins and other controls without elevating ordinary requests", () => {
  const prepared = prepareComponentTest(component, response(), scope());
  assert.equal(prepared.input.name, "Alice");
  for (const change of [
    { ownerId: "foreign" },
    { ownerId: null },
    { localId: "copy" },
    { assistantTaskLinks: null },
    { origin: "https://other.example" },
  ]) {
    assert.throws(() =>
      prepareComponentTest(component, response(), { ...scope(), ...change }),
    );
  }
  for (const change of [
    { url: "https://other.example/action" },
    { method: "GET" },
    { body: "{}" },
  ]) {
    assert.throws(
      () =>
        prepareComponentTest(
          component,
          { ...response(), outcome: { ...outcome, ...change } },
          scope(),
        ),
      /changed/,
    );
  }
  assert.equal(
    prepareComponentTest(component, { ...response(), index: 1 }, scope()),
    null,
  );
  const changed = structuredClone(component);
  changed.code.pvoCompiled.rules[0].action.body = "{}";
  assert.throws(
    () => prepareComponentTest(changed, response(), scope()),
    /changed/,
  );
});

test("retry after a failed playback route uses the saved completed result without submitting again", async () => {
  let sends = 0;
  const f = fixture({
    send: async (_url, options) => {
      sends++;
      return Response.json({
        actionId: JSON.parse(options.body).actionId,
        result: "accepted",
      });
    },
  });
  const patch = f.state.patch;
  let failRoute = true;
  f.state.patch = (values) => {
    if (values.t === 7 && failRoute) {
      failRoute = false;
      throw new Error("Playback route interrupted");
    }
    patch(values);
  };
  await f.submit("Alice");
  assert.equal(f.feedback().join.phase, "failed");
  assert.equal([...f.store.records.values()][0].response.result, "accepted");
  await f.submit("Changed form must not replace the saved action");
  assert.equal(f.state.t, 7);
  assert.equal(sends, 1);
  assert.equal([...f.store.records.values()][0].action.input.name, "Alice");
  f.session.stopTry();
});

test("Try closes owned storage, suppresses late account/project/component effects and keeps the original uncertain action", async () => {
  for (const invalidate of [
    (f) => {
      f.account.ownerId = "foreign";
    },
    (f) => {
      f.state.localId = "another";
    },
    (f) => {
      f.item.serviceConnection = undefined;
    },
    (f) => f.session.stopTry(),
  ]) {
    let release, started;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const f = fixture({
      send: async (_url, options) => {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        return Response.json({
          actionId: JSON.parse(options.body).actionId,
          result: "accepted",
        });
      },
    });
    const pending = f.submit();
    await waiting;
    invalidate(f);
    release();
    await pending;
    assert.notEqual(f.state.t, 7);
    assert.equal(f.store.records.size, 1);
    assert.equal(f.store.closed, 1);
    f.session.stopTry();
  }
});

test("storage failure sends nothing and HTTP rejection keeps SDK feedback and the saved intent", async () => {
  let sent = 0;
  const failed = fixture({
    openStore: async () => {
      throw new Error("Storage unavailable");
    },
    send: async () => {
      sent++;
      return Response.json({});
    },
  });
  await failed.submit();
  assert.equal(sent, 0);
  assert.equal(failed.feedback().join.phase, "failed");
  failed.session.stopTry();
  const denied = fixture({
    send: async () => new Response(null, { status: 401 }),
  });
  await denied.submit();
  assert.deepEqual(denied.feedback().join.failure, {
    kind: "http",
    status: 401,
    message: "Access denied (401).",
  });
  assert.equal([...denied.store.records.values()][0].response, null);
  denied.session.stopTry();
});

test("component transport rejects credential redirects, oversized bodies and cancellation while reading", async () => {
  const request = {
    url: `${origin}/api/services/${publication.identity.serviceId}/releases/${publication.identity.resourceId}/try`,
    method: "POST",
    headers: {},
    body: "{}",
  };
  for (const url of [
    request.url.replace(origin, "https://other.example"),
    request.url + "?mode=live",
    request.url.replace(/releases\/.*\/try$/, "operate"),
  ]) {
    await assert.rejects(
      sendComponentTest({ ...request, url }, origin, () =>
        assert.fail("Must not send"),
      ),
    );
  }
  let cancelled = false;
  await assert.rejects(
    sendComponentTest(
      request,
      origin,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(10000));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
    /too large/,
  );
  assert.equal(cancelled, true);
  const controller = new AbortController();
  let reading;
  const waiting = new Promise((resolve) => {
    reading = resolve;
  });
  const pending = sendComponentTest(
    request,
    origin,
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            reading();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    controller.signal,
  );
  await waiting;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
