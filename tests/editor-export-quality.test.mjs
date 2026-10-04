import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/domain/export/quality.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { exportFrameSize } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("4K export keeps the project ratio with a 2160-pixel short edge", () => {
  assert.deepEqual(exportFrameSize("9:16", "4K"), { width: 2160, height: 3840 });
  assert.deepEqual(exportFrameSize("16:9", "4K"), { width: 3840, height: 2160 });
  assert.deepEqual(exportFrameSize("1:1", "4K"), { width: 2160, height: 2160 });
  assert.deepEqual(exportFrameSize("4:5", "4K"), { width: 2160, height: 2700 });
  assert.deepEqual(exportFrameSize("9:16", "1080p"), { width: 1080, height: 1920 });
});
