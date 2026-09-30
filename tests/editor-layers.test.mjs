import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

// Exercise the actual TypeScript store, including its scene mirrors and history.
const bundled = buildSync({ stdin: { contents: 'export * from "./editor/src/store.ts"; export * from "./editor/src/features/timeline/geometry.ts"; export * from "./editor/src/features/timeline/clipCommands.ts"; export * from "./editor/src/domain/clips/editing.ts"; export * from "./editor/src/domain/layers/order.ts"; export * from "./editor/src/domain/export/manifest.ts"; export { advanceTry } from "./editor/src/features/preview/tryMode.ts";', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { useCapture, mkClip, layerOrder, layerZ, dragLayer, buildPvoManifest, advanceTry, splitAtPlayhead, deleteSelectedClip, splitClipAt } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const start = () => {
  const clip = mkClip(8, null, 0);
  useCapture.setState({ scenes: [{ id: "main", name: "Main", clips: [clip], texts: [], components: [], muted: false, sound: 0, layers: ["video"] }], currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"], t: 1, sel: -1, selComp: null, selText: null, past: [], future: [], sheet: null });
  return useCapture.getState();
};

test("playback and unrelated UI patches retain scene and layer references", () => {
  const state = start();
  const before = useCapture.getState();
  state.patch({ t: 2, playing: true });
  state.patch({ exPct: 42 });
  const after = useCapture.getState();
  assert.equal(after.t, 2);
  assert.equal(after.playing, true);
  assert.equal(after.exPct, 42);
  assert.strictEqual(after.scenes, before.scenes);
  assert.strictEqual(after.scenes[0], before.scenes[0]);
  assert.strictEqual(after.layers, before.layers);
  assert.strictEqual(after.clips, before.clips);
});

test("scene-changing patches still update mirrors, layer order, and selection", () => {
  const state = start();
  const id = state.addText("Caption");
  assert.equal(useCapture.getState().selText, id);
  state.patch({ texts: [] });
  const after = useCapture.getState();
  assert.deepEqual(after.scenes[0].texts, []);
  assert.strictEqual(after.texts, after.scenes[0].texts);
  assert.deepEqual(after.layers, ["video"]);
  assert.equal(after.selText, null);
});

test("new overlays share a back-to-front stack and each new item starts on top", () => {
  const state = start(), textId = state.addText("Title");
  const componentId = state.addComponent("tooltip");
  const nextTextId = state.addText("Caption");
  assert.deepEqual(layerOrder(useCapture.getState()), ["video", `text:${textId}`, `component:${componentId}`, `text:${nextTextId}`]);
  assert.equal(useCapture.getState().selComp, null);
  assert.equal(useCapture.getState().selText, nextTextId);
});

test("moving under video changes depth, survives history, and preserves timing", () => {
  const state = start(), id = state.addText("Behind");
  state.reorderLayer(`text:${id}`, "down");
  assert.ok(layerZ(useCapture.getState(), `text:${id}`) < layerZ(useCapture.getState(), "video"));
  assert.deepEqual(useCapture.getState().texts.map(({ start, end }) => [start, end]), [[1, 4]]);
  state.undo();
  assert.deepEqual(useCapture.getState().layers, ["video", `text:${id}`]);
  state.redo();
  assert.deepEqual(useCapture.getState().layers, [`text:${id}`, "video"]);
});

test("text edits, duplication and deletion retain independent styles and undo", () => {
  const state = start(), id = state.addText("First");
  state.duplicateText(id);
  const second = useCapture.getState().selText;
  const style = { ...useCapture.getState().texts[1].style, fill: "#ff0000", font: "serif" };
  state.updateText(second, { text: "Second", style, start: 2, end: 6 });
  assert.equal(useCapture.getState().texts[0].text, "First");
  assert.equal(useCapture.getState().texts[0].style.fill, "#ffffff");
  state.deleteText(id);
  assert.ok(!useCapture.getState().layers.includes(`text:${id}`));
  state.undo();
  assert.equal(useCapture.getState().texts.length, 2);
  state.undo();
  assert.equal(useCapture.getState().texts[1].text, "First");
  assert.equal(useCapture.getState().texts[1].style.fill, "#ffffff");
});

test("switching scenes restores each stack and clears text selection", () => {
  const state = start(), id = state.addText("Main title");
  state.reorderLayer(`text:${id}`, "down");
  const branch = state.createScene();
  assert.deepEqual(useCapture.getState().layers, ["video"]);
  assert.equal(useCapture.getState().selText, null);
  state.switchScene("main");
  assert.deepEqual(useCapture.getState().layers, [`text:${id}`, "video"]);
  state.deleteScene(branch);
});

test("interactive export stores text styles and the same mixed layer order", () => {
  const state = start(), id = state.addText("Export title");
  const component = state.addComponent("card");
  state.reorderLayer(`text:${id}`, "up");
  const current = useCapture.getState(), scene = current.scenes[0];
  const manifest = buildPvoManifest(current, [{ scene, assetId: "media", name: "main.webm", type: "video/webm" }]);
  assert.deepEqual(manifest.restyle_capture.scene_layers.main.order, ["video", `component:${component}`, `text:${id}`]);
  assert.equal(manifest.restyle_capture.scene_layers.main.texts[0].style.font, "sans");
});

test("a choice covered by the video cannot wait at its layer end for taps nobody can see", () => {
  const state = start();
  const street = state.createScene(), detail = state.createScene();
  state.switchScene("main");
  state.patch({ t: 1 });
  const id = state.addComponent("choice");
  state.updateComponent(id, { responsePolicy: { dispatch: "layer_end", unanswered: "pause" }, fields: { prompt: "Next?", options: [
    { label: "Street", outcome: { kind: "scene", sceneId: street } },
    { label: "Detail", outcome: { kind: "scene", sceneId: detail } },
  ] } });
  state.reorderLayer(`component:${id}`, "down");
  state.patch({ t: 3.95, tryMode: { playing: true, holdingId: null, handled: [], capturedResponses: {}, dispatched: [] } });
  assert.equal(advanceTry(useCapture.getState(), 4.05), false);
  state.reorderLayer(`component:${id}`, "up");
  assert.equal(advanceTry(useCapture.getState(), 4.05), true);
  assert.equal(useCapture.getState().tryMode.holdingId, id);
  state.patch({ tryMode: null });
});

test("turning off an active unanswered pause releases and handles its boundary", () => {
  const state = start();
  const id = state.addComponent("choice");
  state.updateComponent(id, {
    responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
  });
  state.patch({
    t: 3.95,
    playing: true,
    tryMode: {
      playing: true,
      holdingId: null,
      handled: [],
      capturedResponses: {},
      dispatched: [],
    },
  });
  assert.equal(advanceTry(useCapture.getState(), 4.05), true);
  assert.equal(useCapture.getState().tryMode.holdingId, id);

  const historyLength = useCapture.getState().past.length;
  state.updateComponent(id, {
    responsePolicy: { dispatch: "layer_end", unanswered: "continue" },
  });

  const released = useCapture.getState();
  assert.equal(released.components[0].responsePolicy.unanswered, "continue");
  assert.equal(released.scenes[0].components[0].responsePolicy.unanswered, "continue");
  assert.equal(released.tryMode.holdingId, null);
  assert.equal(released.playing, true);
  assert.equal(released.tryMode.playing, true);
  assert.deepEqual(released.tryMode.handled, [id]);
  assert.equal(released.past.length, historyLength + 1);
  assert.equal(advanceTry(released, 4.05), false, "The released boundary must not pause again");
});

test("turning off unanswered pause does not release an answered layer-end hold", () => {
  const state = start();
  const id = state.addComponent("choice");
  state.updateComponent(id, {
    responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
  });
  const response = { index: 0, outcome: { kind: "continue" } };
  state.patch({
    playing: false,
    tryMode: {
      playing: false,
      holdingId: id,
      handled: [id],
      capturedResponses: { [id]: response },
      dispatched: [],
    },
  });

  state.updateComponent(id, {
    responsePolicy: { dispatch: "layer_end", unanswered: "continue" },
  });

  const held = useCapture.getState();
  assert.equal(held.components[0].responsePolicy.unanswered, "continue");
  assert.equal(held.tryMode.holdingId, id);
  assert.equal(held.playing, false);
  assert.equal(held.tryMode.playing, false);
  assert.strictEqual(held.tryMode.capturedResponses[id], response);
  assert.deepEqual(held.tryMode.handled, [id]);
});

test("vertical dragging can cross mixed row heights and go behind the video", () => {
  const order = ["video", "text:1", "component:card", "text:2"];
  assert.deepEqual(dragLayer(order, "text:2", 40), ["video", "text:1", "text:2", "component:card"]);
  assert.deepEqual(dragLayer(order, "text:2", 140), ["text:2", "video", "text:1", "component:card"]);
  assert.deepEqual(dragLayer(order, "video", -200), ["text:1", "component:card", "text:2", "video"]);
  assert.deepEqual(dragLayer(order, "component:card", -80), ["video", "text:1", "text:2", "component:card"]);
  assert.deepEqual(dragLayer(order, "text:2", 0), order, "Returning to the original slot restores its order");
  assert.deepEqual(order, ["video", "text:1", "component:card", "text:2"], "The gesture's starting rows stay immutable");
});

test("a drag previews order without history and commits as one undo step", () => {
  const state = start(), id = state.addText("Drag me");
  const before = useCapture.getState(), order = before.layers, history = before.past.length;
  const final = dragLayer(order, `text:${id}`, 90);
  state.patch({ layers: final });
  assert.equal(useCapture.getState().past.length, history);
  assert.deepEqual(useCapture.getState().texts.map(({start,end})=>[start,end]), [[1,4]]);
  state.patch({ layers: order });
  state.edit({ layers: final });
  assert.equal(useCapture.getState().past.length, history + 1);
  state.undo();
  assert.deepEqual(useCapture.getState().layers, order);
  state.redo();
  assert.deepEqual(useCapture.getState().layers, final);
});

test("split rules respect source speed, reject short pieces, and leave the original unchanged", () => {
  const clip = { ...mkClip(8, null, 0), in: 1, out: 7, speed: 2 };
  let created = 0;
  const nextId = () => { created += 1; return 9001; };
  assert.equal(splitClipAt([clip], .1, nextId), null);
  assert.equal(splitClipAt([clip], 2.9, nextId), null);
  assert.equal(created, 0, "Rejected edits do not allocate an ID");
  const result = splitClipAt([clip], 1, nextId);
  assert.deepEqual(result.clips.map(({ id, in: start, out: end }) => [id, start, end]), [
    [clip.id, 1, 3], [9001, 3, 7],
  ]);
  assert.equal(result.selectedIndex, 1);
  assert.equal(clip.out, 7);
});

test("the shared split command commits once and preserves scene mirrors through undo and redo", () => {
  const state = start();
  const original = state.clips[0];
  splitAtPlayhead(state);
  const split = useCapture.getState();
  assert.equal(split.past.length, 1);
  assert.equal(split.sel, 1);
  assert.deepEqual(split.clips, split.scenes[0].clips);
  assert.deepEqual(split.clips.map(({ in: start, out: end }) => [start, end]), [[0, 1], [1, 8]]);
  state.undo();
  assert.deepEqual(useCapture.getState().clips, [original]);
  state.redo();
  assert.deepEqual(useCapture.getState().clips, split.clips);
  const history = useCapture.getState().past.length;
  splitAtPlayhead({ ...useCapture.getState(), t: 0 });
  assert.equal(useCapture.getState().past.length, history);
});

test("deleting the last clip in one scene keeps other scene media and can be undone", () => {
  const state = start();
  const original = state.clips[0];
  const branch = state.createScene();
  const branchClip = mkClip(3, null, 1);
  state.updateScene(branch, { clips: [branchClip] });
  state.switchScene("main");
  state.patch({ sel: 0, t: 6, screen: "editor" });
  const before = useCapture.getState();
  deleteSelectedClip(before);
  const after = useCapture.getState();
  assert.equal(after.screen, "editor");
  assert.equal(after.t, 0);
  assert.equal(after.past.length, before.past.length + 1);
  assert.deepEqual(after.clips, []);
  assert.deepEqual(after.scenes.find(scene => scene.id === branch).clips, [branchClip]);
  state.undo();
  assert.deepEqual(useCapture.getState().clips, [original]);
});

test("component duplication and history keep compiled language data independent", () => {
  const state = start();
  const id = state.addComponent("tooltip");
  state.updateComponent(id, { code: {
    custom: true,
    pvo: { structure: "<tooltip><text>Before</text></tooltip>", style: "", logic: "" },
    pvoCompiled: { structure: { type: "tooltip", text: "Before" }, rules: [] },
  } });
  const copyId = state.duplicateComponent(id);
  const current = useCapture.getState();
  const original = current.components.find(component => component.id === id);
  const copy = current.components.find(component => component.id === copyId);
  assert.notEqual(original.code.pvo, copy.code.pvo);
  assert.notEqual(original.code.pvoCompiled.structure, copy.code.pvoCompiled.structure);
  copy.code.pvoCompiled.structure.text = "Changed copy";
  assert.equal(original.code.pvoCompiled.structure.text, "Before");
  state.undo();
  assert.equal(useCapture.getState().components.length, 1);
  assert.equal(useCapture.getState().components[0].code.pvoCompiled.structure.text, "Before");
});
