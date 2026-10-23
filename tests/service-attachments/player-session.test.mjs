import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareServiceAttachmentReceipt,
  projectPublicServiceConnection,
} from "../../packages/pvo-assistant/attachments/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { create, now } from "../assistant-tasks/fixtures.mjs";
import { attachment } from "./fixtures.mjs";
import { createPlaybackSession } from "../../player/playback/session.js";
import { createComponentActions } from "../../player/actions/components.js";
import { createActionRuntimeAdapter } from "../../player/actions/runtime.js";
import { invalidateActionOperations } from "../../player/actions/operations.js";
import {
  readPlayerServiceConnections,
  admitPlayerServiceConnection,
} from "../../player/services/connections.js";
import { createPlayerServiceRequests } from "../../player/services/requests.js";

const publication = await prepareServicePublication(
  create(),
  "host-one",
  await checkedFixture(),
  now + 86400000,
);
const origin = "https://services.example";
const connection = projectPublicServiceConnection({
  origin,
  receipt: prepareServiceAttachmentReceipt(
    publication,
    { identity: publication.identity, state: "available" },
    "join",
    now,
  ),
  connection: attachment(publication.identity.resourceId).connection,
});
const component = {
  id: "join",
  kind: "form",
  title: "Join",
  response_policy: { dispatch: "interaction", unanswered: "pause" },
  presentation: {
    scene: "main",
    start: 0,
    end: 10,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
  fields: [{ name: "guest", type: "text", label: "Guest" }],
  on_submit: {
    type: "request",
    url: `${origin}/api/services/${connection.serviceId}/actions`,
    method: "POST",
    body: { operation: connection.operation.name, input: connection.input },
    into: "responses.join",
    on_success: { type: "seek", time: 7 },
  },
  restyle_capture: {
    version: 1,
    form: { submitMode: "local" },
    service_connection: connection,
  },
};
function storage() {
  const records = new Map();
  let chain = Promise.resolve(),
    closed = 0,
    didClose;
  const whenClosed = new Promise((resolve) => {
    didClose = resolve;
  });
  return {
    records,
    whenClosed,
    get closed() {
      return closed;
    },
    async open() {
      return {
        read: async (key) => structuredClone(records.get(key) ?? null),
        update(key, change) {
          const pending = chain.then(() => {
            const next = change(structuredClone(records.get(key) ?? null));
            records.set(key, structuredClone(next));
            return structuredClone(next);
          });
          chain = pending.catch(() => {});
          return pending;
        },
        close() {
          closed++;
          didClose();
        },
      };
    },
  };
}
async function fixture({
  store = storage(),
  send,
  item = structuredClone(component),
  apply,
  openStore = () => store.open(),
} = {}) {
  const session = createPlaybackSession();
  const timeline = {
    id: "main",
    clips: [
      { id: "video", asset_id: "video", scene: "main", start: 0, end: 10 },
    ],
  };
  const manifest = {
    spec_version: "0.1-prototype",
    allowed_domains: [new URL(origin).host],
    media: [{ id: "video", asset_id: "video" }],
    scenes: [{ id: "main", asset_id: "video", start: 0, end: 10 }],
    playback: { initial_timeline: "main", timelines: [timeline] },
    components: [item],
  };
  session.manifest = manifest;
  session.currentTimeline = timeline;
  session.captureMode = true;
  session.serviceConnections = await readPlayerServiceConnections(
    manifest,
    new Map(),
  );
  const services = createPlayerServiceRequests({
    openStore,
    request: send,
    createId: () => crypto.randomUUID(),
  });
  const applied = [],
    statuses = [];
  const adapters = {
    setStatus: (...args) => statuses.push(args),
    renderOverlays() {},
    updateRuntimeState() {},
    activeClip: () => timeline.clips[0],
    elapsedTime: () => 0,
    componentCanReceiveResponse: () => true,
    visibleComponents: () => [item],
    captureOutcome: () => ({ kind: "continue" }),
    async applyActionOutcome(_component, _index, outcome) {
      await apply?.(outcome);
      applied.push(outcome);
    },
  };
  const runtime = createActionRuntimeAdapter({
    session,
    services,
    refs: { frame: { dispatchEvent() {} } },
    adapters,
  });
  session.actionRuntime = runtime.makeActionRuntime(manifest);
  const actions = createComponentActions({ session, services, adapters });
  return {
    session,
    runtime,
    services,
    item,
    store,
    applied,
    statuses,
    recover: () => actions.recoverServiceSubmission(item.id),
    submit: (guest) =>
      actions.answerFieldComponent({
        componentId: item.id,
        index: 0,
        fields: { guest },
      }),
  };
}

test("player persists exact public input before dispatch, recovers after reload and starts a distinct next action", async () => {
  const store = storage(),
    wires = [];
  const send = async (url, options) => {
    assert.equal(store.records.size, 1);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(url, component.on_submit.url);
    wires.push(options.body);
    if (wires.length === 1) throw new TypeError("Lost successful response");
    return Response.json({
      actionId: JSON.parse(options.body).actionId,
      result: "accepted",
    });
  };
  const first = await fixture({ store, send });
  await first.submit("{state.private.name}");
  assert.equal(first.session.capturedResponses.get("join").status, "failed");
  assert.equal([...store.records.values()][0].response, null);
  const second = await fixture({
    store,
    send,
    apply: () =>
      assert.equal([...store.records.values()][0].response.result, "accepted"),
  });
  await second.submit("{state.private.name}");
  assert.equal(wires[0], wires[1]);
  assert.deepEqual(JSON.parse(wires[0]).input, {
    name: "{state.private.name}",
  });
  assert.deepEqual(second.applied, [{ kind: "time", t: 7 }]);
  assert.deepEqual(
    second.session.actionRuntime.state.responses.join,
    [...store.records.values()][0].response,
  );
  const third = await fixture({ store, send });
  await third.submit("Bob");
  assert.notEqual(JSON.parse(wires[1]).actionId, JSON.parse(wires[2]).actionId);
  assert.equal(store.closed, 3);
});

test("failed playback retries its completed result without a second effect, even when form values change", async () => {
  let sends = 0,
    fail = true;
  const f = await fixture({
    send: async (_url, options) => {
      sends++;
      return Response.json({
        actionId: JSON.parse(options.body).actionId,
        result: "accepted",
      });
    },
    apply: () => {
      if (fail) {
        fail = false;
        throw new Error("Playback unavailable");
      }
    },
  });
  await f.submit("Alice");
  assert.equal(f.session.capturedResponses.get("join").status, "failed");
  await f.submit("Bob");
  assert.equal(sends, 1);
  assert.equal([...f.store.records.values()][0].action.input.name, "Alice");
  assert.deepEqual(f.applied, [{ kind: "time", t: 7 }]);
});

test("load admission rejects altered requests, private metadata, wrong controls and missing/type-changed fields", async () => {
  for (const mutate of [
    (value) => {
      value.on_submit.url += "?mode=try";
    },
    (value) => {
      value.on_submit.body.operation = "private";
    },
    (value) => {
      value.restyle_capture.service_connection.ownerId = "owner";
    },
    (value) => {
      value.restyle_capture.service_connection.event = "press";
      value.restyle_capture.service_connection.target = "button0";
    },
    (value) => {
      value.fields[0].name = "another";
    },
    (value) => {
      value.fields[0].type = "number";
    },
    (value) => {
      value.restyle_capture.code = { language: {} };
    },
  ]) {
    const changed = structuredClone(component);
    mutate(changed);
    assert.throws(() => admitPlayerServiceConnection(changed));
  }
  const card = {
    id: "card",
    kind: "card",
    actions: [
      { action: component.on_submit },
      { action: { type: "custom", name: "restyle_continue" } },
    ],
    restyle_capture: {
      service_connection: {
        ...connection,
        event: "press",
        target: "reserve",
        input: { kind: "literal", value: { name: "Alice" } },
      },
    },
  };
  card.actions[0].action = {
    ...component.on_submit,
    body: {
      operation: "join",
      input: card.restyle_capture.service_connection.input,
    },
  };
  assert.equal(
    admitPlayerServiceConnection(card, {
      structure: { type: "card", buttons: [{ id: "reserve" }, { id: "skip" }] },
    }).index,
    0,
  );
  assert.throws(() => admitPlayerServiceConnection(card));
  const noConnection = structuredClone(component);
  delete noConnection.restyle_capture.service_connection;
  assert.equal(admitPlayerServiceConnection(noConnection), null);
});

test("replay slots are stable across reload and isolated by executable source, release and manifest", async () => {
  const manifest = { components: [component] };
  const languages = new Map([
    [
      "join",
      {
        structure: { type: "form", fields: [{ name: "guest", kind: "name" }] },
        js: "one",
      },
    ],
  ]);
  const slot = (await readPlayerServiceConnections(manifest, languages)).get(
    "join",
  ).slot;
  assert.equal(
    (
      await readPlayerServiceConnections(
        structuredClone(manifest),
        structuredClone(languages),
      )
    ).get("join").slot,
    slot,
  );
  for (const [nextManifest, nextLanguages] of [
    [{ ...manifest, title: "Changed" }, languages],
    [manifest, new Map([["join", { ...languages.get("join"), js: "two" }]])],
    [
      {
        components: [
          {
            ...component,
            restyle_capture: {
              ...component.restyle_capture,
              service_connection: {
                ...connection,
                releaseId: "release-" + "f".repeat(64),
              },
            },
          },
        ],
      },
      languages,
    ],
  ])
    assert.notEqual(
      (await readPlayerServiceConnections(nextManifest, nextLanguages)).get(
        "join",
      ).slot,
      slot,
    );
});

test("changed pending input, unavailable storage and HTTP rejection never produce success or lose the original intent", async () => {
  let sends = 0;
  const f = await fixture({
    send: async () => {
      sends++;
      return new Response(null, { status: 409 });
    },
  });
  await f.submit("Alice");
  assert.equal(f.session.failedRequestComponents.get("join").status, 409);
  const restored = await fixture({
    store: f.store,
    send: async () => assert.fail("Changed unresolved input must not send"),
  });
  await restored.submit("Bob");
  assert.equal([...f.store.records.values()][0].action.input.name, "Alice");
  assert.equal(restored.applied.length, 0);
  const unavailable = await fixture({
    openStore: async () => {
      throw new Error("Storage failed");
    },
    send: async () => assert.fail("Must persist before sending"),
  });
  await unavailable.submit("Alice");
  assert.equal(unavailable.applied.length, 0);
  assert.equal(sends, 1);
});

test("project replacement and seeking suppress late effects while closing storage and retaining recovery", async () => {
  for (const invalidate of [
    (f) => invalidateActionOperations(f.session),
    (f) => {
      f.session.actionRuntime = null;
    },
  ]) {
    let release, started;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const f = await fixture({
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
    const pending = f.submit("Alice");
    await waiting;
    invalidate(f);
    release();
    await pending;
    await f.store.whenClosed;
    assert.equal(f.applied.length, 0);
    assert.equal(f.store.records.size, 1);
    assert.equal(f.store.closed, 1);
  }
});

test("a renderer-shaped object cannot acquire the host request capability", () => {
  const services = createPlayerServiceRequests();
  assert.equal(
    services.forInteraction({ operation: {}, serviceConnection: connection }),
    undefined,
  );
});

test("explicit recovery after reload restores saved values and result without an empty form submission", async () => {
  const store = storage(),
    wires = [];
  const send = async (_url, options) => {
    wires.push(options.body);
    if (wires.length === 1) throw new Error("Lost reply");
    return Response.json({
      actionId: JSON.parse(options.body).actionId,
      result: "accepted",
    });
  };
  const original = await fixture({ store, send });
  await original.submit("Alice");
  const resumed = await fixture({ store, send });
  await resumed.recover();
  assert.equal(wires[1], wires[0]);
  assert.deepEqual(resumed.applied, [{ kind: "time", t: 7 }]);
  assert.equal(resumed.session.actionRuntime.state.form.join.guest, "Alice");
  const completed = await fixture({ store, send });
  await completed.recover();
  assert.equal(wires.length, 2, "saved result needs no new HTTP call");
  assert.deepEqual(completed.applied, [{ kind: "time", t: 7 }]);
});
