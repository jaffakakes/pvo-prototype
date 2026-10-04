import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createPvoRuntime,
  describeRequestFailure,
  validatePvo,
} from "../../packages/pvo-sdk/index.js";
import { manifest } from "./manifest.fixture.mjs";

test("request actions send real HTTP, expose responses, and run ordered actions without implicit routing", async (t) => {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ method: request.method, path: request.url, body });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ accepted: true, confirmation: "ok_123" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const host = `127.0.0.1:${server.address().port}`;
  const m = manifest();
  m.allowed_domains = [host];
  const events = [];
  const runtime = createPvoRuntime(m, {
    gotoScene(scene) {
      events.push(scene);
    },
  });
  await runtime.execute({
    type: "chain",
    actions: [
      { type: "set", key: "order", value: "first" },
      {
        type: "request",
        method: "POST",
        url: `http://${host}/submit`,
        body: { score: "{state.score}" },
        into: "receipt",
        on_success: [
          {
            type: "branch",
            cases: [
              {
                when: { response: "/accepted", is: true },
                then: [
                  { type: "set", key: "order", value: "accepted" },
                  {
                    type: "set",
                    key: "receipt_id",
                    value: "{response.confirmation}",
                  },
                ],
              },
            ],
            else: { type: "goto_scene", scene: "ending" },
          },
        ],
      },
      { type: "set", key: "finished", value: true },
    ],
  });
  assert.deepEqual(received, [
    { method: "POST", path: "/submit", body: '{"score":1}' },
  ]);
  assert.equal(runtime.state.order, "accepted");
  assert.equal(runtime.state.receipt_id, "ok_123");
  assert.equal(runtime.state.receipt.confirmation, "ok_123");
  assert.equal(runtime.state.finished, true);
  assert.deepEqual(events, []);
});

test("request domains are opt-in and invalid or disallowed URLs use on_error", async () => {
  const m = manifest();
  delete m.allowed_domains; // Valid manifest, but no network permission.
  assert.equal(validatePvo(m).valid, true);
  let calls = 0;
  const events = [];
  const runtime = createPvoRuntime(m, {
    request() {
      calls += 1;
      return { ok: true };
    },
    onEvent(event) {
      events.push(event.type);
    },
  });
  const denied = {
    type: "request",
    url: "https://creator.example/submit",
    on_success: { type: "set", key: "path", value: "success" },
    on_error: { type: "set", key: "path", value: "error" },
  };
  assert.equal(await runtime.execute(denied), undefined);
  assert.equal(runtime.state.path, "error");
  assert.equal(calls, 0);
  assert.ok(events.includes("request_error"));
  await runtime.execute({
    type: "request",
    url: "https://creator.example/submit",
  });
  assert.equal(calls, 0); // No on_error means no-op, not an uncaught exception.

  m.allowed_domains = ["creator.example"];
  const allowed = createPvoRuntime(m, {
    request() {
      calls += 1;
      return { ok: true };
    },
  });
  for (const url of [
    "https://evil.example/",
    "https://creator.example.evil.example/",
    "ftp://creator.example/",
    "https://user:secret@creator.example/",
    "/relative",
  ]) {
    await allowed.execute({
      type: "request",
      url,
      on_error: { type: "set", key: "last_error", value: "{response.error}" },
    });
    assert.equal(typeof allowed.state.last_error, "string");
  }
  assert.equal(calls, 0);
  await allowed.execute({
    type: "request",
    url: "https://{state.path}.example/",
  });
  assert.equal(calls, 0); // The resolved URL is checked, not just the template.
});

test("HTTP errors, offline failures, and redirects never take the success path or queue requests", async (t) => {
  let unexpectedHits = 0;
  const server = createServer((request, response) => {
    if (request.url === "/fail") {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end('{"error":"unavailable"}');
    } else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/unexpected" });
      response.end();
    } else {
      unexpectedHits += 1;
      response.end("unexpected");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const host = `127.0.0.1:${server.address().port}`;
  const m = manifest();
  m.allowed_domains = [host];
  const runtime = createPvoRuntime(m);
  const action = (url) => ({
    type: "request",
    url,
    on_success: { type: "set", key: "result", value: "success" },
    on_error: { type: "set", key: "result", value: "{response.error}" },
  });
  await runtime.execute(action(`http://${host}/fail`));
  assert.match(runtime.state.result, /503/);
  await runtime.execute(action(`http://${host}/redirect`));
  assert.equal(typeof runtime.state.result, "string");
  assert.notEqual(runtime.state.result, "success");
  assert.equal(unexpectedHits, 0);

  let attempts = 0;
  const offline = createPvoRuntime(m, {
    request() {
      attempts += 1;
      throw new TypeError("Network unavailable");
    },
  });
  await offline.execute(action(`http://${host}/submit`));
  assert.equal(offline.state.result, "Network unavailable");
  assert.equal(attempts, 1);
  await offline.execute({ type: "request", url: `http://${host}/submit` });
  assert.equal(attempts, 2); // No automatic retry or offline queue.
  await assert.rejects(
    () =>
      offline.execute(action(`http://${host}/submit`), {
        throwOnRequestError: true,
      }),
    /Network unavailable/,
  );
  assert.equal(offline.state.result, "Network unavailable"); // on_error ran before the rejection.
  assert.equal(attempts, 3);
});

test("request failures have shared, viewer-safe descriptions and preserve authored errors", async () => {
  const events = [];
  let response = new Response("missing", { status: 404 });
  const runtime = createPvoRuntime(manifest(), {
    request() {
      return response;
    },
    onEvent(event) {
      if (event.type === "request_error") events.push(event);
    },
  });
  const action = {
    type: "request",
    url: "https://creator.example/submit",
    on_error: { type: "set", key: "last_error", value: "{response.error}" },
  };

  await runtime.execute(action);
  assert.deepEqual(events.at(-1).failure, {
    kind: "http",
    status: 404,
    message: "Request not found (404).",
  });
  assert.equal(events.at(-1).handled, true);
  assert.equal(runtime.state.last_error, "Request failed with 404.");

  for (const [status, message] of [
    [401, "Access denied (401)."],
    [403, "Access denied (403)."],
    [408, "Service did not respond (408)."],
    [429, "Too many requests (429). Try again later."],
    [503, "Service error (503). Try again."],
  ]) {
    response = new Response("failed", { status });
    await runtime.execute(action);
    assert.deepEqual(events.at(-1).failure, { kind: "http", status, message });
  }

  const denied = createPvoRuntime(
    { ...manifest(), allowed_domains: [] },
    {
      onEvent(event) {
        if (event.type === "request_error") events.push(event);
      },
    },
  );
  await denied.execute(action);
  assert.deepEqual(events.at(-1).failure, {
    kind: "policy",
    message: "This request is not allowed.",
  });
  assert.equal(events.at(-1).handled, true);

  const network = createPvoRuntime(manifest(), {
    request() {
      throw new TypeError("Failed to fetch https://private.example/token");
    },
    onEvent(event) {
      if (event.type === "request_error") events.push(event);
    },
  });
  await network.execute({
    type: "request",
    url: "https://creator.example/submit",
  });
  assert.deepEqual(events.at(-1).failure, {
    kind: "network",
    message: "Could not reach the service.",
  });
  assert.equal(events.at(-1).handled, false);
  assert.match(events.at(-1).error, /private\.example/);
  assert.equal(
    describeRequestFailure(new Error("private detail")).kind,
    "unknown",
  );
  assert.ok(events.every((event) => event.failure.message.length <= 50));
});

test("imperative request bridges receive parsed data or a rejected Promise", async () => {
  const m = manifest();
  const runtime = createPvoRuntime(m, {
    request() {
      return { ok: true, message: "saved" };
    },
  });
  runtime.setState("form.comp1.text_0", "Ada");
  const data = await runtime.execute(
    {
      type: "request",
      url: "https://creator.example/submit",
      body: { name: "{state.form.comp1.text_0}" },
    },
    { throwOnRequestError: true },
  );
  assert.deepEqual(data, { ok: true, message: "saved" });
  const blocked = createPvoRuntime({ ...m, allowed_domains: [] });
  await assert.rejects(
    () =>
      blocked.execute(
        { type: "request", url: "https://creator.example/submit" },
        { throwOnRequestError: true },
      ),
    /not in allowed_domains/,
  );
});

test("an on_success action failure is not misreported as a network failure", async () => {
  const m = manifest();
  let errors = 0;
  const events = [];
  const runtime = createPvoRuntime(m, {
    request() {
      return { ok: true };
    },
    custom() {
      throw new Error("Action failed");
    },
    onEvent(event) {
      if (event.type.startsWith("request_")) events.push(event.type);
    },
  });
  await assert.rejects(
    () =>
      runtime.execute({
        type: "request",
        url: "https://creator.example/submit",
        on_success: { type: "custom", name: "broken" },
        on_error: { type: "set", key: "error_count", add: 1 },
      }),
    /Action failed/,
  );
  errors = runtime.state.error_count || 0;
  assert.equal(errors, 0);
  assert.deepEqual(events, ["request_start", "request_success"]);
});
