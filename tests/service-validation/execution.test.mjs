import assert from "node:assert/strict";
import test from "node:test";
import { executeServicePackage } from "../../server/cloud-services/packageExecution.js";
import { runServiceStep } from "../../server/assistant/validation/cases.js";
import { fixtureNodeEffect } from "../node-runtime/fixture.mjs";
import { packageFor, dinnerAgreement } from "./fixtures.mjs";
const scope = { ownerId: "owner", serviceId: "service", mode: "validation" };
const namespace = (execute, cancel = async () => ({ ok: true })) => ({
  getByName: () => ({ execute, cancel }),
});

test("checked package delivery carries trusted scope and exact bytes, with no Worker fallback", async () => {
  const source = packageFor();
  let request = null;
  const execution = namespace(async (value) => {
    request = value;
    return { ok: true, value: { result: "ok", state: null } };
  });
  assert.deepEqual(await executeServicePackage(execution, source, {}, scope), {
    result: "ok",
    state: null,
  });
  assert.equal(request.ownerId, scope.ownerId);
  assert.equal(request.serviceId, scope.serviceId);
  assert.equal(request.mode, "validation");
  assert.deepEqual(request.bundle.files, source.files);
  request = null;
  await assert.rejects(
    executeServicePackage(
      execution,
      source,
      { large: "x".repeat(65536) },
      scope,
    ),
    { code: "input_limit" },
  );
  assert.equal(request, null);
  await assert.rejects(
    executeServicePackage(
      {
        load() {
          throw new Error("old loader");
        },
      },
      source,
      {},
      scope,
    ),
    { code: "runtime_unavailable" },
  );
  const changed = structuredClone(source);
  changed.runtime.runnerDigest = "0".repeat(64);
  await assert.rejects(async () =>
    executeServicePackage(execution, changed, {}, scope),
  );
  assert.equal(request, null);
});

test(
  "a real local Node loop is stopped outside its process and cancellation cannot become a passed case",
  { timeout: 8000 },
  async () => {
    const agreement = dinnerAgreement(),
      source = packageFor("export function execute(){for(;;){}}");
    const timed = await runServiceStep(
      namespace(async (value) =>
        (
          await fixtureNodeEffect(
            new Request("https://fixture.test", {
              method: "POST",
              body: JSON.stringify(value),
            }),
          )
        ).json(),
      ),
      source,
      agreement,
      source.agreementDigest,
      0,
      { step: 0, state: agreement.cases[0].initialState },
      scope,
    );
    assert.equal(timed.caseResult.status, "failed");
    assert.equal(timed.caseResult.failure.code, "timeout");
    const stopped = new AbortController();
    let started,
      cancelled = 0;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const checking = runServiceStep(
      namespace(
        () => {
          started();
          return new Promise(() => {});
        },
        async () => {
          cancelled++;
          return { ok: true };
        },
      ),
      packageFor(),
      agreement,
      source.agreementDigest,
      0,
      { step: 0, state: agreement.cases[0].initialState },
      scope,
      stopped.signal,
    );
    await entered;
    stopped.abort();
    const result = await checking;
    assert.equal(result.caseResult.status, "interrupted");
    assert.equal(result.caseResult.completedSteps, 0);
    assert.equal(cancelled, 1);
  },
);
