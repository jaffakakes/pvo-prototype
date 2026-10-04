import test from "node:test";
import assert from "node:assert/strict";
import { createPvoRuntime } from "../../packages/pvo-sdk/index.js";
import { manifest } from "./manifest.fixture.mjs";

test("request deadline includes response parsing and cancels its host signal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let markParsing;
  const parsing = new Promise((resolve) => {
    markParsing = resolve;
  });
  let requestSignal;
  let contextSignal;
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    request(request, context) {
      requestSignal = request.signal;
      contextSignal = context.signal;
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json() {
          markParsing();
          return new Promise(() => {});
        },
      };
    },
    onEvent(event) {
      if (event.type.startsWith("request_")) events.push(event);
    },
  });
  const pending = runtime.execute({
    type: "request",
    url: "https://creator.example/submit",
    into: "receipt",
    on_success: { type: "set", key: "success", value: true },
    on_error: { type: "set", key: "failed", value: true },
  });
  await parsing;
  assert.equal(requestSignal, contextSignal);
  assert.equal(requestSignal.aborted, false);
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(requestSignal.aborted, true);
  assert.equal(runtime.state.receipt, undefined);
  assert.equal(runtime.state.success, undefined);
  assert.equal(runtime.state.failed, true);
  assert.deepEqual(
    events.map((event) => event.type),
    ["request_start", "request_error"],
  );
  assert.deepEqual(events.at(-1).failure, {
    kind: "timeout",
    message: "No response from the service. Try again.",
  });
});

test("an abort-reactive host still reports the deadline as a timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    request({ signal }) {
      markStarted();
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
    onEvent(event) {
      if (event.type === "request_error") events.push(event);
    },
  });
  const pending = runtime.execute({
    type: "request",
    url: "https://creator.example/submit",
  });
  await started;
  t.mock.timers.tick(15_000);
  await pending;
  assert.deepEqual(events[0].failure, {
    kind: "timeout",
    message: "No response from the service. Try again.",
  });
});

test("caller cancellation is silent and clears the request deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let hostSignal;
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    request({ signal }) {
      hostSignal = signal;
      markStarted();
      return new Promise(() => {});
    },
    onEvent(event) {
      if (event.type.startsWith("request_")) events.push(event.type);
    },
  });
  const caller = new AbortController();
  const pending = runtime.execute(
    {
      type: "request",
      url: "https://creator.example/submit",
      on_error: { type: "set", key: "failed", value: true },
    },
    { signal: caller.signal },
  );
  await started;
  caller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(hostSignal.aborted, true);
  t.mock.timers.tick(15_000);
  assert.deepEqual(events, ["request_start"]);
  assert.equal(runtime.state.failed, undefined);
});

test("an aborted request cannot write state or run success or error actions", async () => {
  let release;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    request() {
      markStarted();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    onEvent(event) {
      events.push(event.type);
    },
  });
  const controller = new AbortController();
  const pending = runtime.execute(
    {
      type: "request",
      url: "https://creator.example/submit",
      into: "responses.card",
      on_success: { type: "set", key: "success", value: true },
      on_error: { type: "set", key: "error", value: true },
    },
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  release({ ok: true, message: "late" });
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(runtime.state.responses, undefined);
  assert.equal(runtime.state.success, undefined);
  assert.equal(runtime.state.error, undefined);
  assert.deepEqual(events, ["request_start"]);
});
