import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
      export { beginLayerReorderDrag } from './editor/src/state/editing/layerReorderDrag.ts';
      export { useCapture } from './editor/src/state/captureStore.ts';
      export { initial } from './editor/src/state/project/initial.ts';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { beginLayerReorderDrag, useCapture, initial } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const original = ["video", "text:1", "text:2"];
const reordered = ["text:1", "video", "text:2"];
const branchOrder = ["text:4", "video", "text:3"];
const text = (id) => ({
  id,
  text: String(id),
  start: 0,
  end: 5,
  color: 0,
  x: 50,
  y: 50,
});
function setup() {
  useCapture.setState(initial());
  const main = {
    ...useCapture.getState().scenes[0],
    texts: [text(1), text(2)],
    layers: original,
  };
  useCapture.getState().patch({
    localId: "project-a",
    t: 2,
    scenes: [
      main,
      {
        ...main,
        id: "branch",
        parent: "main",
        texts: [text(3), text(4)],
        layers: branchOrder,
      },
    ],
  });
}
const sceneOrder = (id) =>
  useCapture.getState().scenes.find((scene) => scene.id === id).layers;

test("layer previews commit once and undo/redo preserve the complete scene order", () => {
  setup();
  const drag = beginLayerReorderDrag("text:1");
  assert.deepEqual(drag.order, original);
  assert.equal(drag.update(["text:2", "text:1", "video"]), true);
  assert.equal(drag.update(reordered), true);
  assert.deepEqual(sceneOrder("main"), reordered);
  assert.equal(useCapture.getState().past.length, 0);
  assert.equal(drag.commit(), true);
  assert.equal(useCapture.getState().past.length, 1);
  assert.equal(drag.commit(), false);
  useCapture.getState().undo();
  assert.deepEqual(sceneOrder("main"), original);
  useCapture.getState().redo();
  assert.deepEqual(sceneOrder("main"), reordered);
  assert.deepEqual(sceneOrder("branch"), branchOrder);
});

test("cancelling a preview preserves the original order, playhead, and redo branch", () => {
  setup();
  useCapture.getState().edit({ ratio: "1:1" });
  useCapture.getState().undo();
  const before = useCapture.getState();
  const drag = beginLayerReorderDrag("video");
  drag.update(reordered);
  drag.cancel();
  const after = useCapture.getState();
  assert.deepEqual(after.layers, original);
  assert.equal(after.past, before.past);
  assert.equal(after.future, before.future);
  assert.equal(after.t, before.t);
  assert.equal(drag.update(reordered), false);
  drag.cancel();
  assert.deepEqual(after.layers, original);
});

test("returning to the original order or tapping leaves history unchanged", () => {
  for (const preview of [false, true]) {
    setup();
    const before = useCapture.getState();
    const drag = beginLayerReorderDrag("video");
    if (preview) {
      drag.update(reordered);
      drag.update(original);
    }
    assert.equal(drag.commit(), true);
    assert.deepEqual(useCapture.getState().layers, original);
    assert.equal(useCapture.getState().past, before.past);
    assert.equal(useCapture.getState().future, before.future);
  }
});

test("scene navigation restores the originating preview without touching the new scene", () => {
  for (const finish of ["cancel", "commit"]) {
    setup();
    const drag = beginLayerReorderDrag("text:1");
    drag.update(reordered);
    useCapture.getState().switchScene("branch");
    useCapture.getState().patch({ t: 4 });
    assert.equal(drag.update(original), false);
    const result = drag[finish]();
    if (finish === "commit") assert.equal(result, false);
    const after = useCapture.getState();
    assert.equal(after.currentSceneId, "branch");
    assert.equal(after.t, 4);
    assert.deepEqual(after.layers, branchOrder);
    assert.deepEqual(sceneOrder("main"), original);
    assert.equal(after.past.length, 0);
  }
});

test("Try and playhead picking cancel the preview without replacing viewer state", () => {
  for (const blockedState of [
    {
      tryMode: {
        playing: true,
        holdingId: null,
        handled: [],
        capturedResponses: {},
        dispatched: [],
      },
    },
    { playheadPick: { kind: "text-start", sceneId: "main", textId: 1 } },
  ]) {
    for (const finish of ["cancel", "commit"]) {
      setup();
      const drag = beginLayerReorderDrag("video");
      drag.update(reordered);
      useCapture.getState().patch({ ...blockedState, t: 4, playing: true });
      assert.equal(drag.update(original), false);
      const result = drag[finish]();
      if (finish === "commit") assert.equal(result, false);
      const after = useCapture.getState();
      assert.deepEqual(after.layers, original);
      assert.equal(after.t, 4);
      assert.equal(after.playing, true);
      for (const [key, value] of Object.entries(blockedState))
        assert.equal(after[key], value);
      assert.equal(after.past.length, 0);
    }
  }
});

test("a replacement project with matching scene IDs is never changed by a stale drag", () => {
  for (const finish of ["cancel", "commit"]) {
    setup();
    const drag = beginLayerReorderDrag("video");
    drag.update(reordered);
    // Keep the same history objects to exercise project identity independently.
    useCapture.getState().patch({ localId: "project-b", t: 4 });
    assert.equal(drag.update(original), false);
    const result = drag[finish]();
    if (finish === "commit") assert.equal(result, false);
    const after = useCapture.getState();
    assert.equal(after.localId, "project-b");
    assert.deepEqual(after.layers, reordered);
    assert.equal(after.t, 4);
    assert.equal(after.past.length, 0);
  }
});

test("a newer history entry keeps its layer order when an older drag ends", () => {
  for (const finish of ["cancel", "commit"]) {
    setup();
    const drag = beginLayerReorderDrag("video");
    drag.update(reordered);
    useCapture.getState().reorderLayer("text:2", "down");
    const newer = useCapture.getState();
    assert.equal(drag.update(original), false);
    const result = drag[finish]();
    if (finish === "commit") assert.equal(result, false);
    const after = useCapture.getState();
    assert.deepEqual(after.layers, newer.layers);
    assert.equal(after.past, newer.past);
    assert.equal(after.future, newer.future);
  }
});

test("undo invalidates a drag without removing the resulting redo entry", () => {
  setup();
  useCapture.getState().edit({ layers: reordered });
  const drag = beginLayerReorderDrag("video");
  drag.update(["text:1", "text:2", "video"]);
  useCapture.getState().undo();
  const undone = useCapture.getState();
  assert.equal(drag.commit(), false);
  assert.deepEqual(useCapture.getState().layers, original);
  assert.equal(useCapture.getState().future, undone.future);
  assert.equal(useCapture.getState().past, undone.past);
});

test("an independently patched order is not mistaken for an owned preview", () => {
  setup();
  const drag = beginLayerReorderDrag("video");
  drag.update(reordered);
  const newer = ["text:2", "video", "text:1"];
  useCapture.getState().patch({ layers: newer });
  assert.equal(drag.update(original), false);
  drag.cancel();
  assert.deepEqual(useCapture.getState().layers, newer);
});

test("removing the original scene cannot make cancellation restore it", () => {
  setup();
  useCapture.getState().switchScene("branch");
  const drag = beginLayerReorderDrag("text:4");
  drag.update(["video", "text:3", "text:4"]);
  const main = useCapture.getState().scenes[0];
  useCapture.getState().patch({ scenes: [main], currentSceneId: "main" });
  assert.equal(drag.commit(), false);
  assert.equal(useCapture.getState().scenes.length, 1);
  assert.deepEqual(useCapture.getState().layers, original);
});

test("missing layers and editing blockers cannot start a reorder", () => {
  setup();
  assert.equal(beginLayerReorderDrag("text:999"), null);
  useCapture.getState().patch({
    tryMode: {
      playing: true,
      holdingId: null,
      handled: [],
      capturedResponses: {},
      dispatched: [],
    },
  });
  assert.equal(beginLayerReorderDrag("video"), null);
  useCapture.getState().patch({
    tryMode: null,
    playheadPick: { kind: "text-start", sceneId: "main", textId: 1 },
  });
  assert.equal(beginLayerReorderDrag("video"), null);
});
