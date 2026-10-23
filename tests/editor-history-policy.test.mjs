import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
const build = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { beginOverlayTransform } from './editor/src/state/editing/overlayTransform.ts';
  export { beginComponentTimingDrag } from './editor/src/state/components/componentTimingDrag.ts';
  export { HISTORY_LIMIT } from './editor/src/domain/project/history.ts';
`,
  },
  bundle: true,
  write: false,
  format: "esm",
});
const {
  useCapture,
  initial,
  beginOverlayTransform,
  beginComponentTimingDrag,
  HISTORY_LIMIT,
} = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`
);
function fixture() {
  const state = initial();
  const clip = { id: 1, url: "blob:video", in: 0, out: 8, srcDur: 8, speed: 1 };
  useCapture.setState({
    ...state,
    localId: "original",
    clips: [clip],
    scenes: [{ ...state.scenes[0], clips: [clip] }],
  });
  const id = useCapture.getState().addComponent("tooltip");
  useCapture.getState().patch({ past: [], future: [], sheet: null });
  return id;
}
test("ordinary edits share one bounded Undo history and clear Redo", () => {
  fixture();
  for (let i = 0; i < HISTORY_LIMIT + 5; i++)
    useCapture.getState().edit({ coverAt: i / 10 });
  assert.equal(useCapture.getState().past.length, HISTORY_LIMIT);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().future.length, 1);
  useCapture.getState().edit({ coverAt: 2 });
  assert.equal(useCapture.getState().future.length, 0);
});
test("gestures commit once, cancel quietly and cannot alter a replacement project", () => {
  for (const timing of [false, true]) {
    const id = fixture();
    const begin = () =>
      timing
        ? beginComponentTimingDrag(id, "move")
        : beginOverlayTransform({ kind: "component", id });
    const update = (gesture) =>
      timing
        ? gesture.update(1)
        : gesture.update({ ...gesture.value(), x: 60 });
    const gesture = begin();
    assert(gesture);
    update(gesture);
    assert.equal(useCapture.getState().past.length, 0);
    gesture.commit();
    gesture.commit();
    assert.equal(useCapture.getState().past.length, 1);
    const cancelled = begin();
    update(cancelled);
    cancelled.cancel();
    assert.equal(useCapture.getState().past.length, 1);
    const stale = begin();
    update(stale);
    useCapture
      .getState()
      .patch({
        localId: "copy",
        components: useCapture
          .getState()
          .components.map((component) => ({ ...component, x: 85, at: 3 })),
      });
    const before = JSON.stringify(useCapture.getState().scenes);
    stale.cancel();
    stale.commit();
    assert.equal(JSON.stringify(useCapture.getState().scenes), before);
    assert.equal(useCapture.getState().past.length, 1);
  }
});
