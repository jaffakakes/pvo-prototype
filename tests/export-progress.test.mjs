import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  entryPoints: ["editor/src/features/export/presentation.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { exportProgress, exportView } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const scene = (id, length) => ({
  id,
  clips: [{ in: 0, out: length, speed: 1 }],
  texts: [],
  components: [],
});

test("interactive progress follows cumulative scene duration; flat export estimates Main only", () => {
  const scenes = [scene("main", 2), scene("branch", 6)];
  assert.deepEqual(exportProgress(scenes, "pvo", 25, "rendering", 2), {
    progress: 25,
    stage: 1,
    sceneNumber: 2,
    sceneCount: 2,
    eta: 6,
    duration: 8,
  });
  const flat = exportProgress(scenes, "video", 2, "preparing", 0);
  assert.equal(flat.duration, 2);
  assert.equal(flat.eta, 2);
  assert.equal(flat.sceneCount, 1);
  assert.equal(flat.stage, 0);
});

test("job preparation/download states take precedence over estimated progress and completed UI supersedes gate/picker", () => {
  assert.equal(
    exportProgress([scene("main", 2)], "video", 98, "uploading", 1).stage,
    0,
  );
  assert.equal(
    exportProgress([scene("main", 2)], "video", 75, "downloading", 1).stage,
    2,
  );
  assert.equal(
    exportProgress([scene("main", 2)], "video", 101, "browser", 2).eta,
    0,
  );
  assert.equal(exportView("running", true, "older failure", true), "exporting");
  assert.equal(exportView("done", true, "older failure", true), "done");
  assert.equal(exportView("idle", true, null, true), "gate");
});
