import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_TEXT_MODEL, runNativeModel } from "../server/assistant/native/cloudflare.js";
import { nativeFixture } from "./native-assistant-server.helpers.mjs";

const exhausted = "you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.";

async function rejectProvider(message, fields = {}, binding = {}) {
  let calls = 0;
  let result;
  try {
    await runNativeModel({ ...binding, run: async () => {
      calls++;
      throw Object.assign(new Error(message), fields);
    } }, NATIVE_TEXT_MODEL, {}, new AbortController().signal);
    assert.fail("The provider error must reject");
  } catch (error) {
    result = error;
  }
  assert.equal(calls, 1, "Quota failures must not retry inference");
  return result;
}

test("known Workers AI allowance exhaustion has a fixed public classification instead of transient busy", async () => {
  for (const [message, fields, binding] of [
    [exhausted, { status: 429, internalCode: 4006 }, {}],
    [`4006: ${exhausted}`, {}, {}],
    [exhausted, {}, { lastRequestHttpStatusCode: 429, lastRequestInternalStatusCode: 4006 }],
    ["private provider quota details", { internalCode: 3036 }, {}],
  ]) {
    const error = await rejectProvider(message, fields, binding);
    assert.equal(error.status, 429);
    assert.equal(error.code, "provider_allowance_exhausted");
    assert.match(error.message, /daily allowance is exhausted/);
    assert.doesNotMatch(error.message, /upgrade|10,000|private/i);
  }
});

test("unknown 4006 errors and transient 429 responses do not claim the daily allowance is exhausted", async () => {
  for (const [message, fields, status] of [
    ["private unrelated failure", { internalCode: 4006 }, 503],
    [`Untrusted preceding data: ${exhausted}`, { internalCode: 4006 }, 503],
    ["private busy detail", { status: 429 }, 429],
    ["private provider fault", { status: 503 }, 503],
  ]) {
    const error = await rejectProvider(message, fields);
    assert.equal(error.status, status);
    assert.equal(error.code, undefined);
    assert.doesNotMatch(error.message, /private|allowance|Untrusted/i);
  }
});

test("turn and transcription routes expose only the allowlisted quota code and fixed copy", async t => {
  const fixture = await nativeFixture({ outputs: [
    new Response(exhausted, { status: 429, headers: { "X-Model-Code": "4006" } }),
    new Response("private quota details", { status: 429, headers: { "X-Model-Code": "3036" } }),
    new Response("private busy details", { status: 429 }),
  ] });
  t.after(fixture.close);
  for (const request of [() => fixture.turn(), () => fixture.transcribe()]) {
    const response = await request();
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.code, "provider_allowance_exhausted");
    assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
    assert.match(body.error, /daily allowance is exhausted/);
    assert.doesNotMatch(JSON.stringify(body), /10,000|upgrade|private|4006|3036/);
  }
  const busy = await fixture.turn();
  assert.equal(busy.status, 429);
  assert.deepEqual(await busy.json(), { error: "The assistant is busy. Please try again later." });
  assert.equal(fixture.calls.length, 3);
});
