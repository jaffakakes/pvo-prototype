import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: 'export * from "./editor/src/store.ts"; export * from "./editor/src/state/editing/overlayTransform.ts"; export * from "./editor/src/state/editing/overlayPosition.ts"; export * from "./editor/src/domain/layers/transform.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, beginOverlayTransform, setOverlayPixelPosition,
  overlayPositionFromPixels, overlayPositionToPixels } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
// Compare persisted content; history clones can materialize absent optional keys as undefined.
const projectData = value => JSON.parse(JSON.stringify(value));

function fixture(kind) {
  const clip = mkClip(8, null, 0);
  useCapture.setState({
    scenes: [{ id: "main", name: "Main", clips: [clip], texts: [], components: [], muted: false, sound: 0 }],
    currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"],
    ratio: "9:16", t: 1, sel: -1, selComp: null, selText: null, past: [], future: [], sheet: null, tryMode: null, playheadPick: null,
  });
  const state = useCapture.getState();
  const id = kind === "text" ? state.addText("Pinch") : state.addComponent("tooltip");
  state.patch({ past: [], future: [], sheet: null });
  return { kind, id };
}

for (const kind of ["text", "component"]) {
  test(`${kind} pixel position commits once and survives undo and redo`, () => {
    const target = fixture(kind);
    const state = useCapture.getState();
    const original = projectData(state.scenes);
    const item = state[kind === "text" ? "texts" : "components"][0];
    const unrelated = kind === "text" ? projectData(item.style) : projectData({ fields: item.fields, scale: item.scale });
    assert.equal(setOverlayPixelPosition(target, { x: 324, y: 1440 }), true);
    const moved = useCapture.getState()[kind === "text" ? "texts" : "components"][0];
    assert.deepEqual([moved.x, moved.y], [30, 75]);
    assert.deepEqual(kind === "text" ? projectData(moved.style) : projectData({ fields: moved.fields, scale: moved.scale }), unrelated);
    assert.equal(useCapture.getState().past.length, 1);
    assert.equal(setOverlayPixelPosition(target, { x: 324, y: 1440 }), false, "Re-entering displayed pixels is a no-op");
    assert.equal(useCapture.getState().past.length, 1);
    useCapture.getState().undo();
    assert.deepEqual(projectData(useCapture.getState().scenes), original);
    useCapture.getState().redo();
    assert.deepEqual([useCapture.getState()[kind === "text" ? "texts" : "components"][0].x,
      useCapture.getState()[kind === "text" ? "texts" : "components"][0].y], [30, 75]);
  });
}

test("pixel position uses the current authoring canvas and the existing safe bounds", () => {
  let target = fixture("text");
  assert.equal(setOverlayPixelPosition(target, { x: 0, y: 99999 }), true);
  assert.deepEqual([useCapture.getState().texts[0].x, useCapture.getState().texts[0].y], [8, 94]);
  const history = useCapture.getState().past.length;
  assert.equal(setOverlayPixelPosition(target, { x: NaN }), false);
  assert.equal(setOverlayPixelPosition(target, { y: Infinity }), false);
  assert.equal(useCapture.getState().past.length, history);

  target = fixture("component");
  useCapture.getState().patch({ ratio: "16:9" });
  assert.equal(setOverlayPixelPosition(target, { x: 960, y: 540 }), true);
  assert.deepEqual([useCapture.getState().components[0].x, useCapture.getState().components[0].y], [50, 50]);
});

test("pixel conversion follows the fixed project canvas without rounding stored centers", () => {
  const portrait = { width: 1080, height: 1920 };
  const landscape = { width: 1920, height: 1080 };
  assert.deepEqual(overlayPositionToPixels({ x: 25, y: 75 }, portrait), { x: 270, y: 1440 });
  assert.deepEqual(overlayPositionFromPixels({ x: 960, y: 270 }, landscape), { x: 50, y: 25 });
  const fractional = overlayPositionFromPixels({ x: 333, y: 777 }, portrait);
  assert.deepEqual(overlayPositionToPixels(fractional, portrait), { x: 333, y: 777 });
});

test("entering a displayed integer makes a fractional dragged position exact", () => {
  const target = fixture("text");
  useCapture.getState().updateText(target.id, { x: 30.04 }, false);
  assert.equal(Math.round(overlayPositionToPixels(useCapture.getState().texts[0], { width: 1080, height: 1920 }).x), 324);
  assert.equal(setOverlayPixelPosition(target, { x: 324 }), true);
  assert.equal(useCapture.getState().texts[0].x, 30);
  assert.equal(setOverlayPixelPosition(target, { x: 324 }), false);
  assert.equal(useCapture.getState().past.length, 1);
});

test("direct text position updates now share the drag bounds", () => {
  const target = fixture("text");
  useCapture.getState().updateText(target.id, { x: -20, y: 200 });
  assert.deepEqual([useCapture.getState().texts[0].x, useCapture.getState().texts[0].y], [8, 94]);
});

for (const kind of ["text", "component"]) {
  test(`${kind} transform commits one edit and restores its original center and size through undo`, () => {
    const target = fixture(kind);
    const original = projectData(useCapture.getState().scenes);
    const gesture = beginOverlayTransform(target);
    const start = gesture.value();
    for (let step = 1; step <= 20; step++) {
      assert(gesture.update({ x: start.x + step, y: start.y + step / 2, size: start.size * (1 + step / 20) }));
    }
    assert.equal(useCapture.getState().past.length, 0, "Live frames must not create undo entries");
    gesture.commit();
    const scaled = projectData(useCapture.getState().scenes);
    assert.equal(useCapture.getState().past.length, 1);
    useCapture.getState().undo();
    assert.deepEqual(projectData(useCapture.getState().scenes), original);
    useCapture.getState().redo();
    assert.deepEqual(projectData(useCapture.getState().scenes), scaled);
  });

  test(`${kind} cancelled transform rolls back and preserves pending redo`, () => {
    const target = fixture(kind);
    const first = beginOverlayTransform(target);
    first.update({ ...first.value(), x: 60 });
    first.commit();
    useCapture.getState().undo();
    const before = useCapture.getState();
    const original = projectData(before.scenes);
    const gesture = beginOverlayTransform(target);
    gesture.update({ x: 75, y: 70, size: gesture.value().size * 1.5 });
    gesture.cancel();
    assert.deepEqual(projectData(useCapture.getState().scenes), original);
    assert.strictEqual(useCapture.getState().past, before.past);
    assert.strictEqual(useCapture.getState().future, before.future);
    useCapture.getState().redo();
    assert.equal(useCapture.getState()[kind === "text" ? "texts" : "components"][0].x, 60);
  });
}

test("gesture limits protect usable positions and sizes without changing unrelated style", () => {
  const target = fixture("text");
  const style = { ...useCapture.getState().texts[0].style, rotation: 45, fill: "#aabbcc" };
  useCapture.getState().updateText(target.id, { style }, false);
  const gesture = beginOverlayTransform(target);
  gesture.update({ x: -100, y: 300, size: 300 });
  assert.deepEqual(gesture.value(), { x: 8, y: 94, size: 64 });
  const next = useCapture.getState().texts[0];
  assert.equal(next.style.rotation, 45);
  assert.equal(next.style.fill, "#aabbcc");
  gesture.cancel();
  assert.deepEqual(useCapture.getState().texts[0].style, style);
});

test("a tap or resize returned to the starting geometry adds no undo entry", () => {
  const target = fixture("text");
  useCapture.getState().updateText(target.id, { style: undefined }, false);
  const original = structuredClone(useCapture.getState().texts[0]);
  const gesture = beginOverlayTransform(target);
  const start = gesture.value();
  gesture.update({ ...start, size: start.size * 2 });
  gesture.update(start);
  gesture.commit();
  assert.equal(useCapture.getState().past.length, 0);
  assert.deepEqual(useCapture.getState().texts[0], original, "Legacy text styling must stay unchanged");
});

test("history changes and viewer mode cannot be overwritten by an old gesture", () => {
  const target = fixture("component");
  const gesture = beginOverlayTransform(target);
  gesture.update({ ...gesture.value(), size: 2 });
  useCapture.getState().updateComponent(target.id, { scale: 1.5 });
  assert.equal(gesture.update({ ...gesture.value(), size: 3 }), false);
  gesture.cancel();
  assert.equal(useCapture.getState().components[0].scale, 1.5);
  useCapture.getState().patch({ tryMode: { sceneId: "main" } });
  assert.equal(beginOverlayTransform(target), null);
});

test("an external scene switch cancels live geometry in its original scene", () => {
  const target = fixture("component");
  const state = useCapture.getState();
  const main = state.scenes[0];
  const branch = { ...main, id: "branch", name: "Branch", components: [], layers: ["video"] };
  state.patch({ scenes: [main, branch] });
  const gesture = beginOverlayTransform(target);
  gesture.update({ x: 70, y: 60, size: 2 });
  state.patch({ currentSceneId: "branch" });
  gesture.cancel();
  const after = useCapture.getState();
  assert.equal(after.currentSceneId, "branch");
  assert.deepEqual(after.components, []);
  assert.deepEqual(projectData(after.scenes[0].components), projectData(main.components));
  assert.equal(after.past.length, 0);
});

test("pinching a component with independent dimensions preserves its proportions and cancellation", () => {
  const target = fixture("component");
  const state = useCapture.getState();
  state.updateComponent(target.id, { scale: .5, scaleX: 1.5 }, false);
  const original = projectData(useCapture.getState().components[0]);
  let gesture = beginOverlayTransform(target);
  gesture.update({ ...gesture.value(), size: 3 });
  const enlarged = useCapture.getState().components[0];
  assert.equal(enlarged.scaleX, 3);
  assert(Math.abs(enlarged.scaleY - 1) < 1e-12);
  gesture.cancel();
  assert.deepEqual(projectData(useCapture.getState().components[0]), original);
  gesture = beginOverlayTransform(target);
  gesture.update({ ...gesture.value(), size: 3 });
  gesture.commit();
  state.undo();
  assert.deepEqual(projectData(useCapture.getState().components[0]), original);
  state.redo();
  assert.deepEqual(projectData(useCapture.getState().components[0]), projectData(enlarged));
});
