import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/preview/geometry.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { fitPreviewSize, fitPlayerPreview } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("all project ratios fit the available space and use its limiting dimension", () => {
  for (const ratio of [
    [9, 16],
    [1, 1],
    [4, 5],
    [16, 9],
  ]) {
    for (const [width, height] of [
      [320, 440],
      [430, 210],
      [640, 900],
      [277.5, 63.25],
    ]) {
      const fitted = fitPreviewSize(width, height, ratio);
      assert.ok(fitted.width <= width + 1e-9 && fitted.height <= height + 1e-9);
      assert.ok(
        Math.abs(fitted.width / fitted.height - ratio[0] / ratio[1]) < 1e-9,
      );
      assert.ok(
        Math.abs(fitted.width - width) < 1e-9 ||
          Math.abs(fitted.height - height) < 1e-9,
      );
    }
  }
});

test("raising the sheet shrinks the preview continuously below the former minimum", () => {
  const heights = [440, 300, 160, 99, 48, 12];
  const sizes = heights.map((height) => fitPreviewSize(370, height, [9, 16]));
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i].width < sizes[i - 1].width);
    assert.ok(sizes[i].height < sizes[i - 1].height);
  }
  assert.deepEqual(sizes.at(-1), { width: 6.75, height: 12 });
});

test("collapsed or unavailable preview space has no forced overflow", () => {
  for (const [width, height] of [
    [0, 440],
    [370, 0],
    [0, 0],
    [-1, 10],
    [10, -1],
  ]) {
    assert.deepEqual(fitPreviewSize(width, height, [9, 16]), {
      width: 0,
      height: 0,
    });
  }
});

test("editing controls use free gutters and reserve a row only when needed", () => {
  assert.equal(fitPlayerPreview(430, 540, [9, 16], false).controlsInset, 52);
  assert.equal(fitPlayerPreview(662, 540, [9, 16], false).controlsInset, 0);
  assert.equal(fitPlayerPreview(430, 540, [16, 9], true).controlsInset, 0);
  assert.equal(fitPlayerPreview(430, 450, [1, 1], true).controlsInset, 52);
});

test("video never overlaps the undo, redo or preview touch targets", () => {
  for (const ratio of [
    [9, 16],
    [1, 1],
    [4, 5],
    [16, 9],
  ]) {
    const centered = ratio[0] === ratio[1] || ratio[0] > ratio[1];
    for (const width of [280, 320, 390, 430, 662, 844]) {
      for (const height of [40, 120, 210, 430, 540, 700]) {
        const frame = fitPlayerPreview(width, height, ratio, centered);
        const left = (width - frame.width) / 2;
        const available = height - frame.controlsInset;
        const top = centered
          ? (available - frame.height) / 2
          : available - frame.height;
        const controlsTop = height - 48;
        for (const [buttonLeft, buttonRight] of [
          [8, 52],
          [56, 100],
          [width - 52, width - 8],
        ]) {
          const horizontal =
            Math.min(left + frame.width, buttonRight) -
            Math.max(left, buttonLeft);
          const vertical =
            Math.min(top + frame.height, height - 4) -
            Math.max(top, controlsTop);
          assert.ok(
            horizontal <= 0 || vertical <= 0,
            `Collision at ${width}x${height}, ratio ${ratio}`,
          );
        }
        assert.ok(frame.width <= width && frame.height <= height);
        if (frame.width)
          assert.ok(
            Math.abs(frame.width / frame.height - ratio[0] / ratio[1]) < 1e-9,
          );
      }
    }
  }
});
