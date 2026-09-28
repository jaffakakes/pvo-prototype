import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/preview/tryFeedbackStore.ts"],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useTryFeedback, beginTryRequest, finishTryRequest, reportEmptyScene, clearTryFeedback } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("Try request status belongs to its component and clears after success", () => {
  clearTryFeedback();
  const first = beginTryRequest("card");
  const second = beginTryRequest("form");
  finishTryRequest("card", first, false);
  finishTryRequest("form", second, true);
  assert.equal(useTryFeedback.getState().components.card, undefined);
  assert.equal(useTryFeedback.getState().components.form.phase, "failed");
});

test("an obsolete request cannot overwrite its retry or restore status after leaving Try", () => {
  clearTryFeedback();
  const earlier = beginTryRequest("form");
  const retry = beginTryRequest("form");
  finishTryRequest("form", earlier, true);
  assert.equal(useTryFeedback.getState().components.form.phase, "pending");
  clearTryFeedback();
  finishTryRequest("form", retry, true);
  assert.deepEqual(useTryFeedback.getState().components, {});
});

test("an empty destination remains a local problem rather than being cleared as request success", () => {
  clearTryFeedback();
  const request = beginTryRequest("card");
  reportEmptyScene("card");
  finishTryRequest("card", request, false);
  assert.equal(useTryFeedback.getState().components.card.phase, "emptyScene");
});
