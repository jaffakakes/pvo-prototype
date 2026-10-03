import test from "node:test";
import assert from "node:assert/strict";
import { nativeTurnSchema, parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { AssistantPolicyError } from "../packages/pvo-assistant/policy.js";
import { PvoLanguageError } from "../packages/pvo-language/result.js";
import { NativeAssistantError } from "../server/assistant/native/errors.js";
import { createNativeValidationTrace, nativeValidationDiagnostic } from "../server/assistant/native/validationDiagnostics.js";

function validationError(value) {
  try { parseNativeTurnResult(value); }
  catch (error) { return error; }
  throw new Error("Fixture must fail the canonical validator.");
}
const response = operations => ({ message: "Private user wording", operations, observations: [] });
const event = input => nativeValidationDiagnostic({ stage: "schema", attempt: 1, ...input });

function clean(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /Private|secret|https?:|data:|Bearer|apiKey|user-prompt|model-source/);
  assert(serialized.length < 2048, "One diagnostic is strictly bounded");
}

test("canonical schema failures identify required fields without request or model content", () => {
  const result = { ...response([]), observations: [{ kind: "web_search" }] };
  const diagnostic = event({ error: validationError(result), response: result,
    failureCode: "model_output_invalid", finishReason: "stop" });
  assert.equal(diagnostic.schemaPath, "$.observations[].query");
  assert.equal(diagnostic.rule, "required_field");
  assert.deepEqual(diagnostic.observationKinds, ["web_search"]);
  assert.equal(diagnostic.classification, "model_output_invalid");
  assert.equal(diagnostic.finishReason, "stop");
  clean(diagnostic);
});

test("unknown model property names never enter schema diagnostic paths", () => {
  for (const key of ["PrivateOwnerToken", "secret-url", "secret.url", "__proto__", "constructor", "Private words here"])
  {
    const operation = JSON.parse(`{"kind":"playback.pause",${JSON.stringify(key)}:"secret value"}`);
    const result = response([operation]);
    const diagnostic = event({ error: validationError(result), response: result });
    assert(["unknown_field", "validation_failed"].includes(diagnostic.rule));
    assert(["$.operations[].*", null].includes(diagnostic.schemaPath));
    clean(diagnostic);
  }
});

test("schema array indices are normalized and numeric/string values are never logged", () => {
  const result = response([{ kind: "component.update", sceneId: "Private scene", componentId: "secret-id",
    changes: { width: -999 } }]);
  const diagnostic = event({ error: validationError(result), response: result });
  assert.equal(diagnostic.schemaPath, "$.operations[].changes.width");
  assert.equal(diagnostic.rule, "union_shape");
  assert.doesNotMatch(JSON.stringify(diagnostic), /999|secret-id/);
  clean(diagnostic);
});

test("decode diagnostics discard JSON parser snippets and arbitrary provider finish reasons", () => {
  const diagnostic = nativeValidationDiagnostic({ stage: "decode", attempt: 999,
    error: new SyntaxError('Unexpected token in {"apiKey":"secret"}'), response: "Private model-source",
    finishReason: "secret provider metadata", failureCode: "model_output_invalid" });
  assert.equal(diagnostic.rule, "json_syntax");
  assert.equal(diagnostic.schemaPath, null);
  assert.equal(diagnostic.finishReason, "unknown");
  assert.equal(diagnostic.attempt, 3);
  clean(diagnostic);
});

test("attempted operation and observation names come only from the current contract", () => {
  const result = response([{ kind: "Private custom tool", source: "secret" },
    { kind: "font.apply", fontId: "Private font id" }, { kind: "font.apply" }]);
  result.observations = [{ kind: "web_search", query: "Private user-prompt" }, { kind: "secret observation" }];
  const diagnostic = event({ response: result });
  assert.deepEqual(diagnostic.operationKinds, ["unknown", "font.apply"]);
  assert.deepEqual(diagnostic.observationKinds, ["web_search", "unknown"]);
  assert.equal(diagnostic.operationCount, 3);
  assert.equal(diagnostic.observationCount, 2);
  clean(diagnostic);
});

test("misplaced canonical tools remain identifiable while unknown kinds and repair advice stay private", () => {
  const result = response([{ kind: "font_catalogue", query: "Private font query" }]);
  const diagnostic = event({ response: result, error: validationError(result) });
  assert.equal(diagnostic.schemaPath, "$.operations[].kind");
  assert.equal(diagnostic.rule, "unsupported_value_or_field");
  assert.deepEqual(diagnostic.operationKinds, ["font_catalogue"]);
  assert.doesNotMatch(JSON.stringify(diagnostic), /Allowed|Put it|font query/);
  clean(diagnostic);
  const invented = response([{ kind: "Private secret kind" }]);
  const unknown = event({ response: invented, error: validationError(invented) });
  assert.equal(unknown.schemaPath, "$.operations[].kind");
  assert.deepEqual(unknown.operationKinds, ["unknown"]);
  clean(unknown);
});

test("attempt lists and counts are capped even before strict response validation", () => {
  const kinds = nativeTurnSchema.properties.operations.items.anyOf.map(item => item.properties.kind.const);
  const diagnostic = event({ response: {
    operations: Array.from({ length: 10000 }, (_, index) => ({ kind: kinds[index % kinds.length] })),
    observations: Array.from({ length: 10000 }, () => ({ kind: "font_catalogue" })),
  } });
  assert.equal(diagnostic.operationCount, 25, "25 means above the allowed operation limit");
  assert.equal(diagnostic.observationCount, 5, "5 means above the allowed observation limit");
  assert(diagnostic.operationKinds.length <= 24);
  assert(diagnostic.observationKinds.length <= 4);
  clean(diagnostic);
});

test("fixed semantic and policy rules retain actionable classification without raw details", () => {
  const invalidAnswer = { ...response([{ kind: "playback.pause" }]), answer: "Private answer" };
  const semantic = event({ error: validationError(invalidAnswer), response: invalidAnswer });
  assert.equal(semantic.rule, "answer_requires_terminal_response");
  const policy = nativeValidationDiagnostic({ stage: "policy", status: "failed", phase: "repair", attempt: 2,
    failureCode: "edit_validation_failed",
    error: new AssistantPolicyError("request_changed", "Private URL must stay https://secret.example", {
      part: "Private part", diagnostic: { code: "Private diagnostic", message: "secret model-source" },
    }) });
  assert.equal(policy.rule, "policy_request_changed");
  assert.equal(policy.phase, "repair");
  assert.equal(policy.classification, "edit_validation_failed");
  clean(semantic);
  clean(policy);
});

test("known public classifications and finish reasons survive without arbitrary error properties", () => {
  const error = new NativeAssistantError("model_output_truncated");
  error.private = "secret";
  const diagnostic = event({ stage: "decode", error, finishReason: "length" });
  assert.equal(diagnostic.classification, "model_output_truncated");
  assert.equal(diagnostic.finishReason, "length");
  clean(diagnostic);
  const unknown = event({ error: { code: "secret-code", message: "Private validation failure" }, phase: "Private phase" });
  assert.equal(unknown.rule, "validation_failed");
  assert.equal(unknown.classification, "validation_failed");
  assert.equal(unknown.phase, "initial");
  clean(unknown);
});

test("compiler failures identify the language part without copying source diagnostics", () => {
  const error = new PvoLanguageError("style", { code: "Private code", line: 10, column: 8,
    message: "Private model-source includes https://secret.example" });
  const diagnostic = event({ stage: "policy", error, failureCode: "edit_validation_failed" });
  assert.equal(diagnostic.rule, "compiler_style");
  assert.equal(diagnostic.schemaPath, null);
  clean(diagnostic);
});

test("logging never invokes untrusted response accessors or serializers", () => {
  let reads = 0;
  const result = { toJSON() { throw new Error("Private serializer"); } };
  Object.defineProperty(result, "operations", { get() { reads++; throw new Error("Private getter"); } });
  const diagnostic = event({ response: result });
  assert.equal(reads, 0);
  clean(diagnostic);
});

test("repair/review trace events are bounded and a broken logging sink cannot break a turn", () => {
  const recorded = [];
  const trace = createNativeValidationTrace({ write: value => recorded.push(value) });
  for (let index = 0; index < 50; index++) trace({ stage: index % 2 ? "repair" : "review",
    status: "started", attempt: 2, phase: "review", prompt: "Private user-prompt" });
  assert.equal(recorded.length, 12);
  assert.equal(recorded[0].rule, null);
  recorded.forEach(clean);
  const broken = createNativeValidationTrace({ write: () => { throw new Error("Private sink failure"); } });
  assert.doesNotThrow(() => broken({ stage: "schema", error: new Error("Private validation failure") }));
});

test("invalid stages/statuses are discarded and never copied into the output", () => {
  assert.equal(nativeValidationDiagnostic({ stage: "Private arbitrary stage" }), null);
  assert.equal(nativeValidationDiagnostic({ stage: "schema", status: "Private status" }), null);
  assert.equal(nativeValidationDiagnostic(null), null);
});
