import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: { contents: `
    export * from "./editor/src/features/editor-layout/threadDockGeometry.ts";
    export * from "./editor/src/features/editor-layout/workspaceGeometry.ts";
  `, resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { threadDockMaximum, threadDockMeasurements, threadDockDefault, workspaceGeometry } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("thread expansion preserves navigation, playback and a 190 pixel player at phone heights", () => {
  for (const height of [693, 844, 932]) {
    const measurements = { height: height - 62, header: 56, playback: 52 };
    const maximum = threadDockMaximum(measurements);
    for (const collapsed of [false, true]) {
      const panel = Math.min(maximum, threadDockDefault(collapsed, false));
      const layout = workspaceGeometry(measurements, panel, true);
      assert.ok(layout.preview >= 190);
      assert.equal(layout.header, measurements.header);
      assert.equal(layout.playback, measurements.playback);
    }
  }
});

test("the visual keyboard fits below a compact thread without counting its height twice", () => {
  const keyboardHeight = 236;
  const measurements = { height: 932 - keyboardHeight, header: 80, playback: 52 };
  const visibleThread = Math.min(threadDockMaximum(measurements), threadDockDefault(false, true));
  const layout = workspaceGeometry(measurements, visibleThread, true);
  assert.equal(visibleThread + keyboardHeight, 526);
  assert.equal(layout.preview, 274);
  assert.equal(threadDockDefault(true, true), visibleThread);
});

test("the thread clamps to smaller keyboard viewports while retaining the player", () => {
  const measurements = { height: 693 - 236, header: 56, playback: 52 };
  const panel = Math.min(threadDockMaximum(measurements), threadDockDefault(false, true));
  assert.equal(workspaceGeometry(measurements, panel, true).preview, 190);
  assert.equal(threadDockMaximum({ ...measurements, height: 100 }), 0);
});

test("a constrained keyboard viewport borrows outer navigation space and restores it afterward", () => {
  const measurements = { height: 693 - 236, header: 56, playback: 72 };
  const compact = threadDockMeasurements(measurements, true);
  const panel = Math.min(threadDockMaximum(compact), threadDockDefault(false, true));
  const layout = workspaceGeometry(compact, panel, true);
  assert.equal(panel, 195);
  assert.equal(layout.preview, 190);
  assert.equal(layout.headerVisible, false);
  assert.equal(layout.playback, 72);
  assert.strictEqual(threadDockMeasurements(measurements, false), measurements);
  assert.strictEqual(threadDockMeasurements({ ...measurements, height: 608 }, true).header, 56);
});
