import test from "node:test";
import assert from "node:assert/strict";
import { parseAssistantRequest, parseAssistantResponse, assistantResponseSchema } from "../packages/pvo-assistant/index.js";

const source = { structure: "<tooltip><text>Hello</text></tooltip>", style: "", logic: "" };
const request = { componentType: "tooltip", source, prompt: "Bolder" };
const context = { currentSceneId: "main", duration: 12, scenes: [{ id: "main", name: "Main" }] };
const response = { source, summary: "Changed text", tags: [], followUps: ["One", "Two", "Three"] };

test("shared wire parsing preserves exact source, closes envelopes and accepts optional bounded context", () => {
  assert.deepEqual(parseAssistantRequest(request), request);
  assert.deepEqual(parseAssistantRequest({ ...request, context }), { ...request, context });
  assert.deepEqual(parseAssistantResponse(response), response);
  for (const value of [null, undefined, { ...request, html: "bad" }, { ...request, context: undefined },
    { ...request, context: { ...context, footage: "private" } }, { ...request, source: { ...source, js: "bad" } }])
    assert.throws(() => parseAssistantRequest(value), TypeError);
  assert.throws(() => parseAssistantResponse({ ...response, compiled: {} }), TypeError);
  assert.equal(assistantResponseSchema.additionalProperties, false);
});

test("source limits count UTF-8 bytes, including multibyte characters", () => {
  for (const text of ["x".repeat(20000), "é".repeat(10000), "😀".repeat(5000)]) {
    const value = { ...request, source: { ...source, style: text } };
    assert.equal(parseAssistantRequest(value).source.style, text);
    assert.equal(parseAssistantResponse({ ...response, source: value.source }).source.style, text);
    assert.throws(() => parseAssistantRequest({ ...value, source: { ...value.source, style: text + "x" } }), /20000 UTF-8 bytes/);
  }
});

test("scene context rejects unbounded, ambiguous and invalid playback data", () => {
  for (const invalid of [
    { ...context, duration: -1 }, { ...context, duration: Infinity }, { ...context, duration: NaN },
    { ...context, currentSceneId: "absent" }, { ...context, currentSceneId: "x".repeat(129) },
    { ...context, scenes: [...context.scenes, ...context.scenes] },
    { ...context, scenes: [{ id: "main", name: "x".repeat(121) }] },
    { ...context, scenes: Array.from({ length: 101 }, (_, n) => ({ id: n ? `s${n}` : "main", name: "Scene" })) },
  ]) assert.throws(() => parseAssistantRequest({ ...request, context: invalid }), TypeError);
});
