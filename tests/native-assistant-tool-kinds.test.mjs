import assert from "node:assert/strict";
import test from "node:test";
import { nativeTurnSchema, parseNativeOperation, parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { createNativeValidationTrace } from "../server/assistant/native/validationDiagnostics.js";
import { nativeInput } from "./native-assistant-server.helpers.mjs";

const response = (operations = [], observations = []) => ({ message: "Preparing the phone form.", operations, observations });
const placement = { kind: "component.update", sceneId: "main", componentId: "component-1000", changes: { x: 63, y: 83 } };
const styling = { kind: "component.style", sceneId: "main", componentId: "component-1000", style: "form { color: #111111; }" };
const catalogue = { kind: "font_catalogue", query: "sans" };
function failure(run) {
  try { run(); } catch (error) { return error; }
  throw new Error("The invalid fixture unexpectedly passed.");
}

test("known operation and nested discriminator failures retain their exact argument diagnostics", () => {
  assert.equal(failure(() => parseNativeOperation({ ...placement, componentId: 7 })).message,
    "Operation.componentId must be string.");
  assert.equal(failure(() => parseNativeOperation({ ...styling, style: {} })).message,
    "Operation.style must be string.");
  assert.equal(failure(() => parseNativeOperation({ kind: "font.apply", sceneId: "main", fontId: "google-inter",
    target: { kind: "component", id: 7 } })).message, "Operation.target.id must be string.");
});

test("missing, mistyped and invented tool kinds receive bounded contract-derived repair advice", () => {
  const allowed = nativeTurnSchema.properties.operations.items.anyOf.map(item => item.properties.kind.const).join(", ");
  for (const [value, firstLine] of [
    [{ sceneId: "main" }, "Operation.kind is required."],
    [{ kind: 7 }, "Operation.kind must be string."],
    [{ kind: null }, "Operation.kind must be string."],
    [{ kind: "Private token https://secret.example " + "x".repeat(20000) }, "Operation.kind is unsupported."],
  ]) {
    const error = failure(() => parseNativeOperation(value));
    assert.equal(error.message.split("\n")[0], firstLine);
    assert.ok(error.message.endsWith(`Allowed operation kinds: ${allowed}.`));
    assert.ok(error.message.length < 1200, "Repair guidance fits the service diagnostic limit");
    assert.doesNotMatch(error.message, /Private|secret|https?:/);
  }
  assert.throws(() => parseNativeOperation(null), /unsupported shape/);
  assert.throws(() => parseNativeOperation([]), /unsupported shape/);
});

test("observation requests misplaced among edits explain the separate response boundary", () => {
  for (const request of [catalogue, { kind: "saved_fonts" }, { kind: "web_search", query: "Private query" }]) {
    const result = response([placement, styling, request]);
    const original = structuredClone(result);
    const error = failure(() => parseNativeTurnResult(result));
    assert.match(error.message, /^Response\.operations\[2\]\.kind is unsupported\.\n/);
    assert.ok(error.message.includes(`${request.kind} is an observation request.`));
    assert.match(error.message, /Put it in observations with operations:\[\]/);
    assert.match(error.message, /later response after its result/);
    assert.doesNotMatch(error.message, /Private query|component-1000|#111111/);
    assert.deepEqual(result, original, "Validation does not relocate or apply the rejected tools");
  }
});

test("editing tools misplaced among observations explain the reverse boundary", () => {
  const error = failure(() => parseNativeTurnResult(response([], [placement])));
  assert.match(error.message, /^Response\.observations\[0\]\.kind is unsupported\.\n/);
  assert.match(error.message, /component\.update is an editing operation/);
  assert.match(error.message, /Put it in operations with observations:\[\]/);
  assert.match(error.message, /Allowed observation request kinds: web_search, web_read/);
  assert.doesNotMatch(error.message, /component-1000/);
  const missing = failure(() => parseNativeTurnResult(response([], [{ query: "Private query" }])));
  assert.match(missing.message, /^Response\.observations\[0\]\.kind is required\./);
});

test("service repairs the reproduced wrong-bucket font request with an observations-only response", async () => {
  const request = nativeInput();
  request.prompt = "Use a different font for the prepared phone form.";
  const original = structuredClone(request);
  const invalid = response([placement, styling, catalogue]);
  const corrected = response([], [catalogue]);
  const calls = [];
  const diagnostics = [];
  let compilations = 0;
  const result = await nativeAssistantTurn(request, {
    signal: new AbortController().signal,
    compile: () => { compilations++; throw new Error("The rejected batch must not reach compilation"); },
    trace: createNativeValidationTrace({ write: event => diagnostics.push(event) }),
    models: { textAttemptMs: 1000, generate: async input => {
      calls.push(input);
      return { content: calls.length === 1 ? invalid : corrected };
    } },
  });
  assert.deepEqual(result, corrected);
  assert.equal(calls.length, 2, "Exactly one repair, with no completion review for an observation request");
  assert.equal(compilations, 0);
  assert.deepEqual(request, original);
  const repair = calls[1].messages.at(-1).content;
  assert.match(repair, /font_catalogue is an observation request/);
  assert.match(repair, /Put it in observations with operations:\[\]/);
  assert.match(repair, /NONE of its operations or observations were executed or prepared/);
  assert.equal(diagnostics[0].schemaPath, "$.operations[].kind");
  assert.equal(diagnostics[0].rule, "unsupported_value_or_field");
  assert.deepEqual(diagnostics[0].operationKinds, ["component.update", "component.style", "font_catalogue"]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /component-1000|phone form|#111111/);
});
