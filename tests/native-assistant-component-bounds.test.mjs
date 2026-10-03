import assert from "node:assert/strict";
import test from "node:test";
import { authoredComponentBounds } from "../server/assistant/native/componentBounds.js";
import { nativeMessages, nativeCompletionMessages, nativeRepairMessages } from "../server/assistant/native/prompt.js";
import { parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";
import { nativeInput } from "./native-assistant-server.helpers.mjs";

const canvas = { width: 1080, height: 1920 };
const component = { width: 720, height: 420, scale: 1, scaleX: 1, scaleY: 1, x: 69, y: 85 };
const bounds = authoredComponentBounds(component, canvas);
const keyframe = value => [{ time: 0, value, easing: "linear" }];

test("authored bounds report the actual lower-right overflow instead of treating the center as an edge", () => {
  assert.deepEqual(bounds, { units: "canvas_pixels", width: 720, height: 420,
    margins: { left: 385.2, right: -25.2, top: 1422, bottom: 78 }, outsideEdges: ["right"], fitsCanvas: false });
  const inset = authoredComponentBounds({ ...component,
    x: 100 * (canvas.width - 40 - 720 / 2) / canvas.width,
    y: 100 * (canvas.height - 40 - 420 / 2) / canvas.height }, canvas);
  assert.deepEqual(inset.margins, { left: 320, right: 40, top: 1460, bottom: 40 });
  assert.deepEqual(inset.outsideEdges, []);
  assert.equal(inset.fitsCanvas, true);
});

test("explicit dimensions use runtime uniform scale rather than the independent axis overrides", () => {
  const result = authoredComponentBounds({ ...component, x: 50, y: 50, scale: 1.5, scaleX: 0.25, scaleY: 3 }, canvas);
  assert.deepEqual(result, { units: "canvas_pixels", width: 1080, height: 630,
    margins: { left: 0, right: 0, top: 645, bottom: 645 }, outsideEdges: [], fitsCanvas: true });
  const larger = authoredComponentBounds({ ...component, x: 50, y: 50, scale: 2 }, canvas);
  assert.deepEqual(larger.outsideEdges, ["left", "right"]);
  assert.equal(larger.fitsCanvas, false);
});

test("intrinsic dimensions and invalid coordinates never become invented authored measurements", () => {
  for (const change of [{ width: null }, { height: null }, { width: undefined }, { height: 0 }, { x: NaN }])
    assert.equal(authoredComponentBounds({ ...component, ...change }, canvas), null);
  assert.equal(authoredComponentBounds(component, { width: 0, height: 1920 }), null);
});

test("rotation and animated geometry omit static fit claims while opacity does not change rectangle bounds", () => {
  for (const property of ["x", "y", "scaleX", "scaleY", "rotation"])
    assert.equal(authoredComponentBounds({ ...component, animation: { tracks: { [property]: keyframe(1) } } }, canvas), null);
  assert.equal(authoredComponentBounds({ ...component, animation: { tracks: { rotation: keyframe(45) } } }, canvas), null);
  assert.deepEqual(authoredComponentBounds({ ...component, animation: { tracks: { opacity: keyframe(0) } } }, canvas), bounds,
    "A rectangle bound does not claim that its content is visible");
});

test("planning, repair and completion receive deterministic margins without mutating the project contract", () => {
  const input = nativeInput();
  input.project.scenes[0].components = [{ ...component, id: "phone-form", type: "form", at: 0, duration: 8,
    proportionalScale: 1, label: "Phone number", content: { heading: "Phone number", submitLabel: "Continue" },
    formFields: [{ name: "phone", kind: "phone" }], responsePolicy: { dispatch: "interaction", unanswered: "continue" } }];
  const request = parseNativeTurnRequest(input);
  const original = structuredClone(request);
  const messages = nativeMessages(request, []);
  const terminal = { message: "The form is ready.", operations: [], observations: [] };
  const summaries = [messages, nativeCompletionMessages(messages, terminal, request),
    nativeRepairMessages(messages, terminal, new Error("Provide a concise user-facing message."), request)];
  for (const stage of summaries) {
    const active = stage.at(-1).content;
    const line = active.split("\n").find(value => value.startsWith("Current component values"));
    const [summary] = JSON.parse(line.slice(line.indexOf(": ") + 2));
    assert.deepEqual(summary.authoredBounds, bounds);
    assert.match(active, /fitsCanvas:false means the geometry still needs correction/);
    assert.match(active, /do not measure rendered content, text readability, visibility or font decoding/);
  }
  assert.deepEqual(request, original);
  assert.equal(request.project.scenes[0].components[0].authoredBounds, undefined,
    "Computed prompt facts do not extend the shared project schema");
});
