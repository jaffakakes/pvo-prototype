import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: 'export * from "./editor/src/store.ts"; export * from "./editor/src/state/editing/overlayTransform.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, beginOverlayTransform } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
// Compare persisted content; history clones can materialize absent optional keys as undefined.
const projectData = value => JSON.parse(JSON.stringify(value));

function fixture(kind) {
  const clip = mkClip(8, null, 0);
  useCapture.setState({
    scenes: [{ id: "main", name: "Main", clips: [clip], texts: [], components: [], muted: false, sound: 0 }],
    currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"],
    t: 1, sel: -1, selComp: null, selText: null, past: [], future: [], sheet: null, tryMode: null, playheadPick: null,
  });
  const state = useCapture.getState();
  const id = kind === "text" ? state.addText("Pinch") : state.addComponent("tooltip");
  state.patch({ past: [], future: [], sheet: null });
  return { kind, id };
}

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
