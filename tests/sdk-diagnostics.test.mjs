import assert from "node:assert/strict";
import test from "node:test";
import { createPvoRuntime, sanitizeDiagnosticValue, sanitizeDiagnosticUrl, sanitizeDiagnosticText } from "../packages/pvo-sdk/index.js";

const manifest = () => ({
  spec_version: "0.1-prototype",
  scenes: [{ id: "main", start: 0, end: 10 }],
  components: [],
  allowed_domains: ["service.test"],
  state: { initial: { score: 1 } },
});
const request = extras => ({ type: "request", url: "https://service.test/scores?token=secret", ...extras });
const context = { componentId: "question", diagnostic: { interactionId: "tap-1", sceneId: "main" } };

test("diagnostics observe actions without changing results, including broken observers", async () => {
  const actions = [
    { type: "set", key: "score", add: 1 },
    { type: "set", key: "score", add: 100, when: { key: "score", is: 99 } },
    request({ into: "receipt", on_success: { type: "set", key: "finished", value: true } }),
  ];
  const runs = [];
  for (const onDiagnostic of [undefined, () => { throw new Error("observer failed"); }, async () => { throw new Error("observer failed asynchronously"); }]) {
    let sent = 0;
    const runtime = createPvoRuntime(manifest(), {
      request() { sent += 1; return { accepted: true }; },
      onDiagnostic,
      captureDiagnosticBodies() { throw new Error("capture failed"); },
    });
    const result = await runtime.execute(actions, context);
    runs.push({ result, state: runtime.state, sent });
  }
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);
  assert.equal(runs[0].sent, 1);
  assert.equal(runs[0].state.score, 2);
});

test("request facts retain correlation, status, bounded opted-in bodies and nested action identity", async () => {
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    onDiagnostic: event => events.push(event),
    captureDiagnosticBodies: () => true,
    request: () => new Response(JSON.stringify({ score: 3, name: "Ada", accessToken: 12345 }), {
      status: 201, headers: { "content-type": "application/json" },
    }),
  });
  await runtime.execute(request({
    method: "POST", body: { score: 2, name: "Ada", email: "private@example.test" },
    into: "receipt", on_success: { type: "set", key: "score", add: 1 },
  }), context);
  const start = events.find(event => event.type === "request.started");
  const end = events.find(event => event.type === "request.completed");
  assert.equal(start.requestId, end.requestId);
  assert.equal(end.interactionId, "tap-1");
  assert.equal(end.componentId, "question");
  assert.equal(end.status, 201);
  assert.ok(end.durationMs >= 0);
  assert.equal(start.url, "https://service.test/scores");
  assert.deepEqual(start.requestBody, { score: 2, name: "[private]", email: "[private]" });
  assert.deepEqual(end.responseBody, { score: 3, name: "[private]", accessToken: "[private]" });
  const change = events.find(event => event.type === "state.changed" && event.path === "score");
  assert.equal(change.before, 1);
  assert.equal(change.after, 2);
  assert.equal(change.interactionId, "tap-1");
  assert.ok(events.some(event => event.type === "action.started" && event.parentActionId === start.actionId));
});

test("data capture applies only to requests started after opt-in", async () => {
  const events = [];
  let capturing = false;
  let finish;
  const runtime = createPvoRuntime(manifest(), {
    onDiagnostic: event => events.push(event),
    captureDiagnosticBodies: () => capturing,
    request: () => new Promise(resolve => { finish = resolve; }),
  });
  const pending = runtime.execute(request({ body: { score: 2 }, method: "POST" }), context);
  capturing = true;
  finish({ score: 4 });
  await pending;
  const complete = events.find(event => event.type === "request.completed");
  assert.equal(complete.captured, false);
  assert.equal(complete.responseBody, undefined);
  assert.equal(events.find(event => event.type === "request.started").requestBody, undefined);
});

test("HTTP, policy and network facts do not invent a server-down cause", async () => {
  for (const [url, response, type, reason, status] of [
    ["https://service.test/missing", () => new Response("missing", { status: 404 }), "request.failed", "http", 404],
    ["https://blocked.test/scores", () => { throw new Error("must not send"); }, "request.rejected", "policy", undefined],
    ["https://service.test/scores", () => { throw new TypeError("Failed to fetch"); }, "request.failed", "network", undefined],
  ]) {
    const events = [];
    const runtime = createPvoRuntime(manifest(), { request: response, onDiagnostic: event => events.push(event) });
    await runtime.execute(request({ url }), context);
    const event = events.find(item => item.type === type);
    assert.equal(event.reason, reason);
    assert.equal(event.status, status);
    assert.equal(event.failure.kind, reason);
    assert.ok(events.some(item => item.type === "action.skipped" && item.reason === "no_error_route"));
    assert.doesNotMatch(JSON.stringify(events), /server.down/i);
    if (reason === "policy") assert.equal(events.some(item => item.type === "request.started"), false);
  }
});

test("a successful response remains completed when its follow-up action fails", async () => {
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    onDiagnostic: event => events.push(event), request: () => ({ score: 2 }),
    gotoScene() { throw new Error("PRIVATE_USER_DATA"); },
  });
  await assert.rejects(runtime.execute(request({ on_success: { type: "goto_scene", scene: "missing" } }), context));
  assert.equal(events.filter(event => event.type === "request.completed").length, 1);
  assert.equal(events.filter(event => event.type === "request.failed").length, 0);
  assert.ok(events.some(event => event.type === "action.failed" && event.actionType === "goto_scene"));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_USER_DATA/);
});

test("concurrent requests have separate identities and cancellation cannot become completion", async () => {
  const events = [];
  const finish = [];
  const runtime = createPvoRuntime(manifest(), {
    onDiagnostic: event => events.push(event), request: () => new Promise(resolve => finish.push(resolve)),
  });
  const controller = new AbortController();
  const first = runtime.execute(request({ into: "cancelled" }), { ...context, signal: controller.signal });
  const second = runtime.execute(request({ into: "success" }), {
    componentId: "other", diagnostic: { interactionId: "tap-2", sceneId: "main" },
  });
  controller.abort();
  finish[1]({ accepted: true });
  await assert.rejects(first, error => error.name === "AbortError");
  await second;
  finish[0]({ tooLate: true });
  await Promise.resolve();
  const starts = events.filter(event => event.type === "request.started");
  assert.equal(new Set(starts.map(event => event.requestId)).size, 2);
  assert.equal(events.find(event => event.type === "request.cancelled").requestId, starts[0].requestId);
  assert.equal(events.find(event => event.type === "request.completed").requestId, starts[1].requestId);
  assert.equal(runtime.state.cancelled, undefined);
  assert.equal(events.some(event => event.type === "request.failed"), false);
});

test("timeout facts retain the timed-out request and no success state", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    request: () => new Promise(() => {}), onDiagnostic: event => events.push(event),
  });
  const pending = runtime.execute(request({ into: "receipt" }), context);
  t.mock.timers.tick(15_000);
  await pending;
  const failed = events.find(event => event.type === "request.failed");
  assert.equal(failed.reason, "timeout");
  assert.equal(failed.requestId, events.find(event => event.type === "request.started").requestId);
  assert.equal(runtime.state.receipt, undefined);
});

test("inspection helpers bound data, mask sensitive values and never evaluate getters", () => {
  const data = { score: 2, privateText: "my private details", form: { age: 20 }, accessToken: 987 };
  Object.defineProperty(data, "getter", { enumerable: true, get() { throw new Error("must not run"); } });
  data.self = data;
  const safe = sanitizeDiagnosticValue(data);
  assert.equal(safe.score, 2);
  assert.equal(safe.privateText, "[private]");
  assert.equal(safe.form, "[private]");
  assert.equal(safe.accessToken, "[private]");
  assert.equal(safe.getter, "[unavailable]");
  assert.equal(safe.self, "[circular]");
  assert.ok(JSON.stringify(sanitizeDiagnosticValue(Array.from({ length: 10000 }, () => data))).length < 10000);
  assert.equal(sanitizeDiagnosticUrl("https://user:pass@service.test/scores?name=Ada#token"), "https://service.test/scores");
  assert.equal(sanitizeDiagnosticUrl("https://service.test/token/SECRET"), "https://service.test/token/[private]");
  assert.doesNotMatch(sanitizeDiagnosticText("Failed https://service.test/scores?token=SECRET Authorization: Bearer SECRET"), /SECRET/);
  assert.doesNotMatch(sanitizeDiagnosticText("access_token=SECRET"), /SECRET/);
});

test("state history contains no values until capture is enabled", async () => {
  const events = [];
  const runtime = createPvoRuntime(manifest(), { onDiagnostic: event => events.push(event) });
  await runtime.execute({ type: "set", key: "score", add: 1 }, context);
  const change = events.find(event => event.type === "state.changed");
  assert.equal(change.path, "score");
  assert.equal(change.before, undefined);
  assert.equal(change.after, undefined);
  assert.equal(Object.hasOwn(change, "state"), false);
});

test("state diagnostics never read accessors or change a valid setter result", () => {
  for (const diagnosticMode of ["off", "observe", "capture"]) {
    const events = [];
    let reads = 0;
    let stored = 0;
    const runtime = createPvoRuntime(manifest(), diagnosticMode === "off" ? {} : {
      onDiagnostic: event => events.push(event),
      captureDiagnosticBodies: () => diagnosticMode === "capture",
    });
    // Structured state snapshots omit this accessor. Updating it was valid before diagnostics.
    const bucket = Object.defineProperty({}, "value", {
      get() { reads += 1; throw new Error("An observer must not read this accessor."); },
      set(value) { stored = value; },
    });
    runtime.setState("bucket", bucket);
    runtime.setState("bucket.value", 3);
    assert.equal(stored, 3, diagnosticMode);
    assert.equal(reads, 0, diagnosticMode);
    if (diagnosticMode === "capture") {
      const change = events.find(event => event.path === "bucket.value");
      assert.equal(change.before, "[unavailable]");
      assert.equal(change.after, 3);
    }
  }
});

test("captured state history snapshots before-values without reading mutable state later", () => {
  const events = [];
  const previous = { points: 1 };
  let mutatePrevious = false;
  const runtime = createPvoRuntime(manifest(), {
    onDiagnostic: event => events.push(event),
    captureDiagnosticBodies: () => true,
    onEvent() { if (mutatePrevious) previous.points = 99; },
  });
  runtime.setState("score", 4);
  const change = events.find(event => event.path === "score");
  assert.equal(change.before, 1);
  assert.equal(change.after, 4);
  runtime.setState("totals", previous);
  mutatePrevious = true;
  runtime.setState("totals", { points: 4 });
  const objectChange = events.filter(event => event.path === "totals").at(-1);
  assert.equal(previous.points, 99);
  assert.deepEqual(objectChange.before, { points: 1 });
  assert.deepEqual(objectChange.after, { points: 4 });
});

test("inspection does not invoke array accessors, overridden methods or text coercion", () => {
  let reads = 0;
  const values = [1, 2];
  Object.defineProperty(values, "0", { get() { reads += 1; return 99; } });
  Object.defineProperty(values, "slice", { get() { reads += 1; throw new Error("No array methods."); } });
  assert.deepEqual(sanitizeDiagnosticValue(values), ["[unavailable]", 2]);
  const coercion = { get toString() { reads += 1; throw new Error("No coercion."); } };
  assert.equal(sanitizeDiagnosticUrl(coercion), "[invalid URL]");
  assert.equal(sanitizeDiagnosticText(coercion), "Diagnostic unavailable.");
  assert.equal(sanitizeDiagnosticValue(1, coercion), "[unavailable]");
  assert.equal(reads, 0);
});

test("successful custom response status accessors cannot affect request results", async () => {
  for (const diagnosticMode of ["off", "observe", "capture"]) {
    const events = [];
    let statusReads = 0;
    const runtime = createPvoRuntime(manifest(), {
      ...(diagnosticMode !== "off" ? { onDiagnostic: event => events.push(event) } : {}),
      captureDiagnosticBodies: () => diagnosticMode === "capture",
      request: () => ({
        ok: true,
        get status() { statusReads += 1; throw new Error("Status is not available on this adapter."); },
        headers: { get: () => "application/json" },
        json: async () => ({ score: 7 }),
      }),
    });
    const result = await runtime.execute(request({ into: "receipt" }), context);
    assert.deepEqual(result, { score: 7 }, diagnosticMode);
    assert.deepEqual(runtime.state.receipt, { score: 7 }, diagnosticMode);
    assert.equal(statusReads, 0, diagnosticMode);
    if (diagnosticMode !== "off") {
      const completion = events.find(event => event.type === "request.completed");
      assert(completion);
      assert.equal(completion.status, undefined);
      assert.equal(events.some(event => event.type === "request.failed"), false);
    }
  }
});

test("custom response data properties still provide diagnostic HTTP status", async () => {
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    onDiagnostic: event => events.push(event),
    request: () => ({ ok: true, status: 202, headers: { get: () => "application/json" }, json: async () => ({ accepted: true }) }),
  });
  await runtime.execute(request(), context);
  assert.equal(events.find(event => event.type === "request.completed").status, 202);
});
