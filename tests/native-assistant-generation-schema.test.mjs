import assert from "node:assert/strict";
import test from "node:test";
import { nativeTurnSchema, parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { nativeGenerationSchema } from "../server/assistant/native/generationSchema.js";

// Evaluate the JSON Schema vocabulary emitted to providers against concrete
// candidate responses, independently of the application's canonical parser.
function matches(schema, value) {
  if (schema.anyOf && !schema.anyOf.some(option => matches(option, value))) return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "array") return Array.isArray(value)
    && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity)
    && value.every(item => matches(schema.items, item));
  if (schema.type === "object") return value !== null && typeof value === "object" && !Array.isArray(value)
    && (schema.required ?? []).every(key => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, item]) => schema.properties?.[key]
      ? matches(schema.properties[key], item) : schema.additionalProperties !== false);
  if (schema.type === "integer") return Number.isSafeInteger(value);
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  return !schema.type || typeof value === schema.type;
}

const terminal = { message: "The form is ready.", operations: [], observations: [] };
const create = {
  kind: "component.add", sceneId: "main", componentType: "form", at: 0, duration: null,
  source: {
    structure: '<form><heading>Phone number</heading><field name="phone" kind="phone" label="Phone number"/><submit>Continue</submit></form>',
    style: "form { background: #ffffff; }",
    logic: "on submit { continue(); }",
  },
};
const edits = (...operations) => ({ ...terminal, operations });
const inspect = (...observations) => ({ ...terminal, observations });
const update = { kind: "component.update", sceneId: "main", componentId: "form-id",
  changes: { x: 85, y: 85, width: 320, height: null, scale: 1, scaleX: null, scaleY: null } };
const font = { kind: "font.apply", sceneId: "main", target: { kind: "component", id: "form-id" }, fontId: "google-inter" };

test("generation schema permits canonical phone form creation, placement, styling and font tools", () => {
  const schema = nativeGenerationSchema();
  for (const response of [edits(create), edits(update, font,
    { kind: "component.style", sceneId: "main", componentId: "form-id", style: "form { border-radius: 12px; }" }),
  edits({ ...font, target: { kind: "text", id: 4 }, fontId: null }), terminal,
  { ...terminal, answer: "Use a visible label beside the phone field." }, { ...terminal, blocked: true }]) {
    assert.deepEqual(parseNativeTurnResult(response), response);
    assert.ok(matches(schema, response), JSON.stringify(response));
  }
});

test("generation rejects unsupported fields and wrong tool argument types before canonical validation", () => {
  const schema = nativeGenerationSchema();
  const invalid = [
    { ...create, x: 85, y: 85 },
    { ...create, componentType: "phone" },
    { ...create, source: { structure: create.source.structure, style: "" } },
    { ...update, componentId: 12 },
    { ...update, changes: { fontFamily: "Inter" } },
    { kind: "component.content", sceneId: "main", componentId: "form-id", changes: { fields: [{ name: "phone", kind: "phone" }] } },
    { kind: "component.style", sceneId: "main", componentId: "form-id", style: { color: "#ffffff" } },
    { ...font, target: { kind: "text", id: "12" } },
    { ...font, fontId: 12 },
    { kind: "execute", code: "arbitrary()" },
  ];
  for (const operation of invalid) {
    assert.equal(matches(schema, edits(operation)), false, JSON.stringify(operation));
    assert.throws(() => parseNativeTurnResult(edits(operation)));
  }
});

test("generation separates edits, observations, successful answers and explicit blockers", () => {
  const schema = nativeGenerationSchema();
  const web = { kind: "web_read", url: "https://www.w3.org/WAI/tutorials/forms/" };
  for (const response of [
    { ...edits(create), observations: [web] },
    { ...edits(create), answer: "Done" },
    { ...edits(create), blocked: true },
    { ...inspect(web), answer: "Done" },
    { ...inspect(web), blocked: true },
    { ...terminal, blocked: true, answer: "Done" },
    { ...terminal, blocked: false },
    { ...terminal, evidence: ["Invented source evidence"] },
    { message: "Missing both required arrays" },
    { ...terminal, operations: Array.from({ length: 25 }, () => create) },
    inspect(...Array.from({ length: 5 }, () => web)),
  ]) assert.equal(matches(schema, response), false, JSON.stringify(response));
  assert.ok(matches(schema, inspect(web)));
  assert.ok(matches(schema, edits(...Array.from({ length: 24 }, () => create))));
});

test("generation advertises only available animation, tracking and word timing capabilities", () => {
  const animation = { kind: "animation.set", sceneId: "main", target: { kind: "component", id: "form-id" },
    tracks: { opacity: [{ time: 0, value: 0, easing: "linear" }, { time: 1, value: 1, easing: "ease-in" }] } };
  const follow = { kind: "animation.follow", sceneId: "main", target: { kind: "component", id: "form-id" },
    observationId: "track-id", anchor: "center", offsetX: 0, offsetY: 0 };
  const tracking = { kind: "object_tracking", sceneId: "main", clipId: 1, start: 0, end: 2,
    target: { kind: "text", text: "red car" } };
  const timing = { kind: "word_timing", sceneId: "main", start: 0, end: 2,
    source: { kind: "clip", id: 1 }, text: "Hello world", language: "en" };
  for (const enabled of [false, true]) for (const trackingEnabled of [false, true]) for (const timingEnabled of [false, true]) {
    const schema = nativeGenerationSchema({ animation: enabled, objectTracking: trackingEnabled, wordTiming: timingEnabled });
    assert.equal(matches(schema, edits(animation)), enabled);
    assert.equal(matches(schema, edits(follow)), enabled && trackingEnabled);
    assert.equal(matches(schema, inspect(tracking)), enabled && trackingEnabled);
    assert.equal(matches(schema, inspect(timing)), timingEnabled);
  }
  const ask = nativeGenerationSchema({ mode: "ask", animation: true, objectTracking: true, wordTiming: true });
  assert.equal(matches(ask, edits(create)), false);
  assert.equal(matches(ask, edits(animation)), false);
  assert.ok(matches(ask, inspect(tracking)));
  assert.ok(matches(ask, terminal));
});

test("generation constrains web request arguments while accepting real research and font workflows", () => {
  const schema = nativeGenerationSchema({ mode: "ask" });
  for (const request of [
    { kind: "web_search", query: "accessible form design" },
    { kind: "web_read", url: "https://www.w3.org/WAI/tutorials/forms/" },
    { kind: "saved_fonts" }, { kind: "font_catalogue", query: "sans" },
    { kind: "font_import", family: "Inter", url: "https://rsms.me/inter/font-files/Inter-Regular.woff2",
      licenseUrl: "https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt" },
  ]) {
    assert.deepEqual(parseNativeTurnResult(inspect(request)), inspect(request));
    assert.ok(matches(schema, inspect(request)));
  }
  for (const request of [
    { kind: "web_search", query: ["form design"] },
    { kind: "web_read", url: "https://example.com", headers: { Authorization: "secret" } },
    { kind: "font_import", family: "Inter", url: "https://example.com/font.woff2" },
    { kind: "web_unavailable", requestedKind: "web_search", message: "Invented result" },
  ]) assert.equal(matches(schema, inspect(request)), false);
});

test("provider shape projection does not weaken canonical bounds or mutate shared schemas", () => {
  const original = structuredClone(nativeTurnSchema);
  const schema = nativeGenerationSchema({ animation: true, wordTiming: true, objectTracking: true });
  for (const response of [edits({ ...update, changes: { x: -1 } }),
    edits({ ...create, source: { ...create.source, style: "x".repeat(20001) } })]) {
    assert.ok(matches(schema, response), "Provider grammar intentionally omits value bounds");
    assert.throws(() => parseNativeTurnResult(response), "Canonical acceptance still enforces every bound");
  }
  schema.anyOf[0].properties.operations.items.anyOf[0].properties.kind.const = "changed-by-caller";
  assert.deepEqual(nativeTurnSchema, original);
  assert.ok(matches(nativeGenerationSchema(), edits(font)), "Later requests retain canonical tool kinds");
});
