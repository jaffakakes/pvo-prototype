import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `export * from "./editor/src/features/timeline/timingSnap.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { snappedTimingDelta, TIMING_SNAP_DISTANCE_PX } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("timing edges magnetize to the playhead within the eight-pixel zone", () => {
  assert.deepEqual(snappedTimingDelta(1, 2.15, 3, 40, true), {
    delta: 2,
    snapped: true,
  });
  assert.deepEqual(
    snappedTimingDelta(1, 2 + TIMING_SNAP_DISTANCE_PX / 40, 3, 40, true),
    { delta: 2, snapped: true },
  );
});

test("timing snapping stays pixel-based across zoom levels", () => {
  assert.equal(snappedTimingDelta(1, 2.07, 3, 120, true).snapped, false);
  assert.equal(snappedTimingDelta(1, 2.07, 3, 40, true).snapped, true);
  assert.equal(snappedTimingDelta(1, 2.51, 3, 16, true).snapped, false);
});

test("leaving the magnetic zone resumes free trimming and the toggle disables it", () => {
  assert.deepEqual(snappedTimingDelta(1, 2.21, 3, 40, true), {
    delta: 2.21,
    snapped: false,
  });
  assert.deepEqual(snappedTimingDelta(1, 2.02, 3, 40, false), {
    delta: 2.02,
    snapped: false,
  });
});

test("a non-tenth playhead remains an exact snap target", () => {
  const result = snappedTimingDelta(1, 3.08, 4.03, 40, true);
  assert.equal(result.snapped, true);
  assert.ok(Math.abs(result.delta - 3.03) < Number.EPSILON * 4);
});
