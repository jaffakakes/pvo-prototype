import assert from "node:assert/strict";
import test from "node:test";
import { assistantDraft, assistantFixture, assistantInput } from "./assistant-server.helpers.mjs";

test("no-code logic proposals are blocked without repair, while custom appearances remain supported", async t => {
  const next = assistantDraft();
  const request = { url: "https://example.com", method: "POST", body: "{}", onSuccess: { kind: "continue" }, onError: null };
  next.source.logic = `on press(next) { request(${JSON.stringify(request)}); }`;
  const fixture = await assistantFixture({ outputs: [next, assistantDraft()] });
  t.after(fixture.close);
  const response = await fixture.request({ ...assistantInput(), editingMode: "no-code" });
  assert.equal(response.status, 409);
  assert.equal(fixture.calls.length, 1, "Do not silently substitute or partially repair a logic edit outside the selected mode");
  assert.match(fixture.calls[0].input.messages[0].content, /ONLY to LOGIC/);
  assert.equal((await fixture.request({ ...assistantInput(), editingMode: "no-code" })).status, 200,
    "Custom radius and typography do not require Advanced");
});

test("a structured advanced-logic refusal leaves source untouched and maps to the mode response", async t => {
  const fixture = await assistantFixture({ outputs: [{ ...assistantDraft(), source: assistantInput().source, requiresAdvancedLogic: true }] });
  t.after(fixture.close);
  assert.equal((await fixture.request()).status, 409);
  assert.equal(fixture.calls.length, 1);
});

test("assistant route returns a real compiled proposal without requiring publication login", async t => {
  const fixture = await assistantFixture();
  t.after(fixture.close);
  const result = await fixture.request();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), assistantDraft());
  assert.equal(fixture.reservations.length, 1);
  const { model, input } = fixture.calls[0];
  assert.equal(model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(input.temperature, 0.2);
  assert.equal(input.max_tokens, 2048);
  assert.equal(input.response_format.type, "json_schema");
  assert.equal(input.response_format.json_schema.additionalProperties, false);
  assert.equal(input.tools, undefined);
  assert.deepEqual(JSON.parse(input.messages[1].content), assistantInput());
});

test("origin, wire size, model context size and invalid PVO fail before inference", async t => {
  const fixture = await assistantFixture();
  t.after(fixture.close);
  assert.equal((await fixture.request(assistantInput(), { headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await fixture.request({ ...assistantInput(), html: "<script>bad()</script>" })).status, 400);
  assert.equal((await fixture.request({ ...assistantInput(), prompt: "x".repeat(100000) })).status, 413);
  assert.equal((await fixture.request({ ...assistantInput(), source: {
    ...assistantInput().source, structure: `<card><title>${"x".repeat(15000)}</title></card>`, style: " ".repeat(12000),
  } })).status, 413);
  assert.equal((await fixture.request({ ...assistantInput(), source: {
    ...assistantInput().source, style: "body { position: fixed; }",
  } })).status, 400);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.reservations.length, 0);
});

test("a compiler diagnostic permits one separately budgeted repair of the exact proposal", async t => {
  const rejected = assistantDraft();
  rejected.source.style = "card { box-shadow: 0 0 6px #fff; }";
  const fixture = await assistantFixture({ outputs: [rejected, assistantDraft()] });
  t.after(fixture.close);
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), assistantDraft());
  assert.equal(fixture.reservations.length, 2);
  const messages = fixture.calls[1].input.messages;
  assert.equal(messages.length, 4);
  assert.deepEqual(JSON.parse(messages[2].content), rejected);
  assert.match(messages[3].content, /box-shadow|property/i);
});

test("invalid repair is rejected and no third model invocation starts", async t => {
  const rejected = assistantDraft();
  rejected.source.logic = 'on press(next) { go_to_scene("invented"); }';
  const fixture = await assistantFixture({ outputs: [rejected, rejected] });
  t.after(fixture.close);
  assert.equal((await fixture.request()).status, 422);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.reservations.length, 2);
});

test("repair cannot bypass the inference budget", async t => {
  const rejected = assistantDraft();
  rejected.source.style = "card { opacity: 0; }";
  const fixture = await assistantFixture({ outputs: [rejected], allow: count => count === 1 });
  t.after(fixture.close);
  assert.equal((await fixture.request()).status, 429);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.reservations.length, 2);
});

test("schema-invalid model output is rejected without fabricated fallback or repair", async t => {
  const fixture = await assistantFixture({ outputs: [{ ...assistantDraft(), javascript: "run()" }] });
  t.after(fixture.close);
  assert.equal((await fixture.request()).status, 422);
  assert.equal(fixture.calls.length, 1);
});

test("provider failure is curated and unavailable configuration fails closed", async t => {
  const fixture = await assistantFixture({ outputs: [new Response("private provider error", { status: 500 })] });
  const disabled = await assistantFixture({ available: false });
  t.after(async () => { await fixture.close(); await disabled.close(); });
  const failed = await fixture.request();
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("private provider"));
  assert.equal((await disabled.request()).status, 503);
  assert.equal(disabled.calls.length, 0);
  assert.equal(disabled.reservations.length, 0);
});
