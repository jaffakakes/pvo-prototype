import assert from "node:assert/strict";
import test from "node:test";
import { executeServicePackage } from "../../server/assistant/validation/packageExecution.js";
import { runServiceCase } from "../../server/assistant/validation/cases.js";
import { packageFor, dinnerAgreement } from "./fixtures.mjs";
const loader = (fetch) => ({
  load() {
    return { getEntrypoint: () => ({ fetch }) };
  },
});

test("validation rejects malformed bytes and cancels oversized streaming output", async () => {
  const source = packageFor();
  await assert.rejects(
    executeServicePackage(
      loader(async () => new Response(Uint8Array.of(255))),
      source,
      {},
    ),
    { code: "invalid_reply" },
  );
  await assert.rejects(
    executeServicePackage(
      loader(async () => new Response("{")),
      source,
      {},
    ),
    { code: "invalid_reply" },
  );
  let cancelled = false;
  await assert.rejects(
    executeServicePackage(
      loader(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(4096));
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
      ),
      source,
      {},
    ),
    { code: "output_limit" },
  );
  assert.equal(cancelled, true);
  let called = false;
  await assert.rejects(
    executeServicePackage(
      loader(async () => {
        called = true;
        return Response.json({});
      }),
      source,
      { large: "x".repeat(65536) },
    ),
    { code: "invalid_reply" },
  );
  assert.equal(called, false);
});

test(
  "an unresponsive program times out and explicit cancellation cannot become a passed case",
  { timeout: 8000 },
  async () => {
    const source = packageFor(),
      agreement = dinnerAgreement();
    const never = loader(() => new Promise(() => {}));
    const timed = await runServiceCase(
      never,
      source,
      agreement,
      source.agreementDigest,
      0,
    );
    assert.equal(timed.status, "failed");
    assert.equal(timed.failure.code, "timeout");
    assert.equal(timed.completedSteps, 0);
    const stopped = new AbortController();
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const checking = runServiceCase(
      loader(() => {
        started();
        return new Promise(() => {});
      }),
      source,
      agreement,
      source.agreementDigest,
      0,
      stopped.signal,
    );
    await entered;
    stopped.abort();
    const result = await checking;
    assert.equal(result.status, "interrupted");
    assert.equal(result.failure.code, "interrupted");
    assert.equal(result.completedSteps, 0);
  },
);
