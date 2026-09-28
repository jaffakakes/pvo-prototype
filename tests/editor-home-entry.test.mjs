import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `export { enterCameraHome } from "./editor/src/app/homeEntry.ts";
      export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: "browser", format: "esm",
});
const { enterCameraHome, useCapture, initial, mkClip } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("mobile home enters the restored scene's camera without losing footage or undo", () => {
  useCapture.setState(initial());
  useCapture.getState().edit({ clips: [mkClip(3, null, 0)], screen: "editor" });
  const sceneId = useCapture.getState().createScene({ name: "Restored scene" });
  useCapture.getState().edit({ clips: [mkClip(2, null, 1)] });
  const before = useCapture.getState();
  assert.equal(enterCameraHome(true, true, before), true);
  const after = useCapture.getState();
  assert.equal(after.screen, "camera");
  assert.equal(after.currentSceneId, sceneId);
  assert.equal(after.recordingInto, sceneId);
  assert.deepEqual(after.scenes, before.scenes);
  assert.equal(after.past, before.past);
  assert.equal(after.future, before.future);
  after.switchScene(sceneId);
  assert.equal(useCapture.getState().screen, "editor");
  assert.deepEqual(useCapture.getState().clips, before.clips);
});

test("desktop, ordinary reloads and active operations are not redirected to camera", () => {
  useCapture.setState(initial());
  useCapture.getState().patch({ screen: "editor" });
  for (const [requested, mobile, changes] of [
    [true, false, {}], [false, true, {}],
    [true, true, { recording: true }], [true, true, { importing: true }],
    [true, true, { ex: "running" }],
  ]) {
    assert.equal(enterCameraHome(requested, mobile, { ...useCapture.getState(), ...changes }), false);
    assert.equal(useCapture.getState().screen, "editor");
  }
});
