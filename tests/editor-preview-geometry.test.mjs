import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/preview/geometry.ts"],
  bundle: true, write: false, format: "esm", platform: "node",
});
const { fitPreviewSize } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("all project ratios fit the available space and use its limiting dimension", () => {
  for (const ratio of [[9, 16], [1, 1], [4, 5], [16, 9]]) {
    for (const [width, height] of [[320, 440], [430, 210], [640, 900], [277.5, 63.25]]) {
      const fitted = fitPreviewSize(width, height, ratio);
      assert.ok(fitted.width <= width + 1e-9 && fitted.height <= height + 1e-9);
      assert.ok(Math.abs(fitted.width / fitted.height - ratio[0] / ratio[1]) < 1e-9);
      assert.ok(Math.abs(fitted.width - width) < 1e-9 || Math.abs(fitted.height - height) < 1e-9);
    }
  }
});

test("raising the sheet shrinks the preview continuously below the former minimum", () => {
  const heights = [440, 300, 160, 99, 48, 12];
  const sizes = heights.map(height => fitPreviewSize(370, height, [9, 16]));
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i].width < sizes[i - 1].width);
    assert.ok(sizes[i].height < sizes[i - 1].height);
  }
  assert.deepEqual(sizes.at(-1), { width: 6.75, height: 12 });
});

test("collapsed or unavailable preview space has no forced overflow", () => {
  for (const [width, height] of [[0, 440], [370, 0], [0, 0], [-1, 10], [10, -1]]) {
    assert.deepEqual(fitPreviewSize(width, height, [9, 16]), { width: 0, height: 0 });
  }
});
