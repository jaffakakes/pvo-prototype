import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `
      export * from "./editor/src/store.ts";
      export * from "./editor/src/domain/scenes/rules.ts";
      export * from "./editor/src/domain/scenes/references.ts";
      export * from "./editor/src/domain/scenes/languageReferences.ts";
      export { createRoutedScene } from "./editor/src/state/scenes/sceneRoutingCommands.ts";
      export * from "./editor/src/infrastructure/projectPersistence/checkpoint.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const {
  useCapture, initial, mkClip, mainScene, normalizeSceneTree, sceneChildren, sceneDepth,
  sceneTree, sceneSubtreeIds, nextSceneName, deletionImpact, sceneRouteLabel,
  clearDeletedLanguageRoutes, captureCheckpoint, storeCheckpoint, restoreCheckpoint,
  createRoutedScene,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function start() {
  useCapture.setState(initial());
  return useCapture.getState();
}

test("outcome-created children route the original component and open camera in one undo step", () => {
  const state = start();
  state.patch({ clips: [mkClip(8, null, 0)], screen: "editor" });
  const componentId = state.addComponent("choice");
  const before = useCapture.getState().past.length;
  const original = structuredClone(useCapture.getState().components[0].fields.options[0].outcome);
  const id = createRoutedScene(componentId, { kind: "option", index: 0 });
  const after = useCapture.getState();
  assert.equal(after.scenes.find(scene => scene.id === id).parent, "main");
  assert.equal(after.recordingInto, id);
  assert.equal(after.screen, "camera");
  assert.equal(after.past.length, before + 1);
  assert.deepEqual(after.scenes[0].components[0].fields.options[0].outcome, { kind: "scene", sceneId: id });
  after.undo();
  assert.equal(useCapture.getState().scenes.length, 1);
  assert.deepEqual(useCapture.getState().components[0].fields.options[0].outcome, original);
});

test("new scenes route modern Form responses after switching and reject stale targets", () => {
  const state = start();
  state.patch({ clips: [mkClip(8, null, 0)], screen: "editor" });
  const componentId = state.addComponent("form");
  const before = useCapture.getState().past.length;
  const id = createRoutedScene(componentId, { kind: "form" }, "error");
  assert.deepEqual(useCapture.getState().scenes[0].components[0].fields.failureOutcome, { kind: "scene", sceneId: id });
  assert.equal(useCapture.getState().past.length, before + 1);
  assert.equal(sceneRouteLabel(useCapture.getState().scenes, id), useCapture.getState().scenes[0].components[0].fields.submitLabel);
  assert.equal(createRoutedScene(componentId, { kind: "form" }, "success"), null);
  assert.equal(useCapture.getState().scenes.length, 2);
});

test("desktop outcome-created branches stay in the editor and undo the route and scene together", () => {
  const state = start();
  state.patch({ clips: [mkClip(8, null, 0)], screen: "editor" });
  const componentId = state.addComponent("choice");
  const before = useCapture.getState().past.length;
  const original = structuredClone(useCapture.getState().components[0].fields.options[0].outcome);
  const id = createRoutedScene(componentId, { kind: "option", index: 0 }, undefined, { openCamera: false });
  const after = useCapture.getState();
  assert.equal(after.screen, "editor");
  assert.equal(after.recordingInto, null);
  assert.equal(after.currentSceneId, id);
  assert.equal(after.clips.length, 0);
  assert.equal(after.scenes.find(scene => scene.id === id).parent, "main");
  assert.equal(after.past.length, before + 1);
  assert.deepEqual(after.scenes[0].components[0].fields.options[0].outcome, { kind: "scene", sceneId: id });
  after.undo();
  assert.equal(useCapture.getState().currentSceneId, "main");
  assert.equal(useCapture.getState().scenes.length, 1);
  assert.equal(useCapture.getState().screen, "editor");
  assert.deepEqual(useCapture.getState().components[0].fields.options[0].outcome, original);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().currentSceneId, id);
  assert.equal(useCapture.getState().screen, "editor");
  assert.equal(useCapture.getState().recordingInto, null);
  assert.deepEqual(useCapture.getState().scenes[0].components[0].fields.options[0].outcome, { kind: "scene", sceneId: id });
});

function scene(id, parent, name = id) {
  return { ...mainScene(), id, parent, name };
}

test("legacy scenes normalize to one main root and invalid ancestry cannot form a cycle", () => {
  const legacy = [scene("main", "a"), scene("a", undefined), scene("b", null), scene("c", "missing")];
  const normalized = normalizeSceneTree(legacy);
  assert.deepEqual(normalized.map(item => [item.id, item.parent]), [
    ["main", null], ["a", "main"], ["b", "main"], ["c", "main"],
  ]);
  assert.equal(legacy[0].parent, "a", "Migration does not mutate its input");
  const repaired = normalizeSceneTree([scene("a", "b"), scene("b", "a")]);
  assert.equal(repaired.filter(item => item.parent === null).length, 1);
  assert.equal(sceneTree(repaired).length, 3);
});

test("tree traversal preserves creation order among siblings and uses every depth", () => {
  const scenes = [mainScene(), scene("a", "main"), scene("b", "main"), scene("a1", "a"), scene("deep", "a1")];
  assert.deepEqual(sceneChildren(scenes, "main").map(item => item.id), ["a", "b"]);
  assert.deepEqual(sceneTree(scenes).map(({ scene: item, depth }) => [item.id, depth]), [
    ["main", 0], ["a", 1], ["a1", 2], ["deep", 3], ["b", 1],
  ]);
  assert.deepEqual([...sceneSubtreeIds(scenes, "a")].sort(), ["a", "a1", "deep"]);
  assert.equal(sceneDepth(scenes, "deep"), 3);
});

test("new scenes use sibling names by depth and stay in the empty editor", () => {
  const state = start();
  const first = state.createScene();
  assert.equal(useCapture.getState().screen, "editor");
  assert.equal(useCapture.getState().scenes.at(-1).name, "Scene A");
  assert.equal(useCapture.getState().scenes.at(-1).parent, "main");
  const secondLevel = state.createScene();
  assert.equal(useCapture.getState().scenes.at(-1).name, "Scene i");
  assert.equal(useCapture.getState().scenes.at(-1).parent, first);
  const thirdLevel = state.createScene();
  assert.equal(useCapture.getState().scenes.at(-1).name, "Scene 1");
  state.createScene();
  assert.equal(useCapture.getState().scenes.at(-1).name, "Scene 1");
  assert.equal(useCapture.getState().scenes.at(-1).parent, thirdLevel);
  state.switchScene(first);
  state.createScene();
  assert.equal(useCapture.getState().scenes.at(-1).name, "Scene ii");
  state.switchScene("main");
  state.createScene();
  assert.equal(useCapture.getState().scenes.at(-1).name, "Scene B");
  state.switchScene(secondLevel);
  state.patch({ sel: -1 });
  assert.equal(useCapture.getState().screen, "editor");
  const alphabet = Array.from({ length: 26 }, (_, index) => scene(String(index), "main", `Scene ${String.fromCharCode(65 + index)}`));
  assert.equal(nextSceneName([mainScene(), ...alphabet]), "Scene AA");
});

test("scene navigation clears editing state and preserves project undo and redo", () => {
  const state = start();
  const branch = state.createScene();
  state.updateScene(branch, { name: "Renamed" });
  state.undo();
  state.patch({ t: 4, sheet: "more", selText: 99, playing: true, playheadPick: { kind: "text-start", textId: 1, sceneId: branch, originalT: 0 } });
  const before = useCapture.getState();
  state.switchScene("main");
  const after = useCapture.getState();
  assert.strictEqual(after.past, before.past);
  assert.strictEqual(after.future, before.future);
  assert.equal(after.t, 0);
  assert.equal(after.sheet, null);
  assert.equal(after.playheadPick, null);
  assert.equal(after.selText, null);
  assert.equal(after.playing, false);
  state.redo();
  assert.equal(useCapture.getState().scenes.find(item => item.id === branch).name, "Renamed");
});

test("main cannot be deleted or reparented and branches cannot be moved into descendants", () => {
  const state = start();
  const parent = state.createScene();
  const child = state.createScene();
  const before = useCapture.getState();
  state.deleteScene("main");
  state.updateScene("main", { parent });
  state.updateScene(parent, { parent: child });
  state.updateScene(parent, { parent: null });
  state.updateScene(parent, { parent: "missing" });
  assert.strictEqual(useCapture.getState().scenes, before.scenes);
  assert.strictEqual(useCapture.getState().past, before.past);
});

test("same-scene undo keeps an open text draft sheet and valid playhead picking", () => {
  const state = start();
  state.patch({ screen: "editor" });
  const textId = state.addText("Caption");
  const pick = { kind: "text-start", textId, sceneId: "main", originalT: 0 };
  state.patch({ sheet: "text", draft: "Unfinished caption", playheadPick: pick });
  state.edit({ ratio: "1:1" });
  state.undo();
  const restored = useCapture.getState();
  assert.equal(restored.sheet, "text");
  assert.equal(restored.draft, "Unfinished caption");
  assert.deepEqual(restored.playheadPick, pick);
  state.undo();
  assert.equal(useCapture.getState().playheadPick, null, "Removed text cannot retain a time pick");
});

test("subtree deletion repairs direct, request, compiled and PVO source routes in one undo step", () => {
  const state = start();
  const parent = state.createScene({ name: "Parent" });
  const child = state.createScene({ name: "Child" });
  state.switchScene("main");
  const componentId = state.addComponent("choice");
  const request = { kind: "request", url: "https://example.com", method: "POST", body: `Keep ${child}`, onSuccess: { kind: "scene", sceneId: child }, onError: { kind: "scene", sceneId: parent } };
  const logic = `on choose(left) { go_to_scene(${JSON.stringify(parent)}); }\non choose(right) { request(${JSON.stringify(request)}); }`;
  state.updateComponent(componentId, {
    fields: { prompt: "Pick a look", options: [{ label: "Parent", outcome: { kind: "scene", sceneId: parent } }, { label: "Child", outcome: request }] },
    code: {
      custom: true, pvoLiteral: true, pvoTouched: false,
      pvo: { structure: "custom structure", style: "custom style", logic },
      pvoCompiled: { structure: { type: "choice", prompt: "Pick a look", options: [{ id: "left", label: "Parent" }, { id: "right", label: "Child" }] }, rules: [
        { event: "choose", target: "left", action: { kind: "scene", sceneId: parent } },
        { event: "choose", target: "right", action: request },
      ] },
    },
  });
  assert.deepEqual(deletionImpact(useCapture.getState().scenes, parent).map(item => item.componentId), [componentId]);
  assert.equal(sceneRouteLabel(useCapture.getState().scenes, child), "Child");
  state.switchScene(child);
  const before = useCapture.getState();
  state.deleteScene(parent);
  const after = useCapture.getState();
  assert.deepEqual(after.scenes.map(item => item.id), ["main"]);
  assert.equal(after.currentSceneId, "main");
  assert.equal(after.past.length, before.past.length + 1);
  const component = after.components[0];
  assert.deepEqual(component.fields.options[0].outcome, { kind: "continue" });
  assert.deepEqual(component.fields.options[1].outcome.onSuccess, { kind: "continue" });
  assert.deepEqual(component.fields.options[1].outcome.onError, { kind: "continue" });
  assert.deepEqual(component.code.pvoCompiled.rules[1].action.onSuccess, { kind: "continue" });
  assert.match(component.code.pvo.logic, /continue\(\)/);
  assert.doesNotMatch(component.code.pvo.logic, /go_to_scene/);
  assert.equal(component.code.pvo.structure, "custom structure");
  assert.equal(component.code.pvo.style, "custom style");
  assert.equal(component.fields.options[1].outcome.body, `Keep ${child}`);
  state.undo();
  const restored = useCapture.getState();
  assert.equal(restored.currentSceneId, child);
  assert.equal(restored.scenes.find(item => item.id === "main").components[0].code.pvo.logic, logic);
  state.redo();
  assert.equal(useCapture.getState().scenes.length, 1);
});

test("route cleanup preserves quoted request data, comments and unfinished drafts", () => {
  const request = { url: "https://example.com", body: 'go_to_scene("deleted")', onSuccess: { kind: "scene", sceneId: "deleted" }, onError: null };
  const source = `// go_to_scene("deleted")\non submit { request(${JSON.stringify(request)}); }\n/* go_to_scene("deleted") */\nunfinished go_to_scene(`;
  const cleared = clearDeletedLanguageRoutes(source, new Set(["deleted"]));
  assert.ok(cleared.startsWith('// go_to_scene("deleted")'));
  assert.ok(cleared.includes('/* go_to_scene("deleted") */'));
  assert.ok(cleared.endsWith("unfinished go_to_scene("));
  assert.ok(cleared.includes(JSON.stringify(request.body)));
  assert.ok(cleared.includes('"onSuccess":{"kind":"continue"}'));
});

test("duplicating a scene creates a sibling with independent IDs, fields and layer order", () => {
  const state = start();
  const parent = state.createScene();
  const clip = mkClip(3, "blob:shared", 0);
  state.edit({ clips: [clip] });
  const textId = state.addText("Caption");
  const componentId = state.addComponent("choice");
  state.reorderLayer(`text:${textId}`, "up");
  const child = state.createScene();
  state.switchScene(parent);
  const before = useCapture.getState();
  const duplicate = state.duplicateScene(parent);
  const after = useCapture.getState();
  const copy = after.scenes.find(item => item.id === duplicate);
  const original = after.scenes.find(item => item.id === parent);
  assert.equal(copy.parent, "main");
  assert.equal(copy.name, "Scene A copy");
  assert.equal(copy.clips[0].url, "blob:shared");
  assert.notEqual(copy.clips[0].id, clip.id);
  assert.notEqual(copy.texts[0].id, textId);
  assert.notEqual(copy.components[0].id, componentId);
  assert.equal(copy.components[0].sceneId, duplicate);
  assert.deepEqual(copy.layers, ["video", `component:${copy.components[0].id}`, `text:${copy.texts[0].id}`]);
  assert.notStrictEqual(copy.components[0].fields.options, original.components[0].fields.options);
  assert.equal(after.scenes.find(item => item.id === child).parent, parent, "Descendants are not duplicated");
  assert.equal(after.past.length, before.past.length + 1);
  state.undo();
  assert.ok(!useCapture.getState().scenes.some(item => item.id === duplicate));
});

test("checkpoints migrate legacy ancestry across current project and both history branches", () => {
  const state = start();
  const legacyScenes = [scene("main", undefined), scene("branch", undefined)];
  const project = { scenes: legacyScenes, currentSceneId: "branch", ratio: "9:16", allowedDomains: [] };
  useCapture.setState({ ...project, past: [project], future: [project] });
  const record = storeCheckpoint(captureCheckpoint(useCapture.getState()), new Map(), 1);
  for (const saved of [record.project, ...record.past, ...record.future])
    saved.scenes.forEach(item => { delete item.parent; });
  const restored = restoreCheckpoint(record, new Map());
  for (const saved of [restored.project, ...restored.past, ...restored.future]) {
    assert.equal(saved.scenes[0].parent, null);
    assert.equal(saved.scenes[1].parent, "main");
  }
  assert.equal(state.currentSceneId, "main");
});

test("canceling recording preserves empty parents, descendant footage and authored overlays", () => {
  const state = start();
  const parent = state.createScene();
  const child = state.createScene();
  state.edit({ clips: [mkClip(3, "blob:child", 0)] });
  state.startRecordingIntoScene(parent);
  const before = useCapture.getState();
  state.cancelRecordingIntoScene();
  assert.deepEqual(useCapture.getState().scenes, before.scenes);
  assert.equal(useCapture.getState().currentSceneId, parent);
  assert.equal(useCapture.getState().screen, "editor");
  assert.equal(useCapture.getState().recordingInto, null);
  assert.equal(useCapture.getState().scenes.find(item => item.id === child).clips.length, 1);
  const authored = state.createScene();
  state.addComponent("choice");
  state.startRecordingIntoScene(authored);
  state.cancelRecordingIntoScene();
  assert.ok(useCapture.getState().scenes.some(item => item.id === authored));
  const emptyLeaf = state.createScene({ openCamera: true });
  state.cancelRecordingIntoScene();
  assert.ok(!useCapture.getState().scenes.some(item => item.id === emptyLeaf));
});

test("deleting a branch repairs modern Form outcomes and saved code before it can be restored", () => {
  const state = start();
  const branch = state.createScene();
  state.switchScene("main");
  const id = state.addComponent("form");
  const target = { kind: "scene", sceneId: branch };
  state.updateComponent(id, {
    fields: {
      formFields: [{ name: "Name", type: "text" }], heading: "Contact", submitLabel: "Send",
      successOutcome: target, failureOutcome: target,
    },
    archivedCode: {
      custom: true,
      pvo: { structure: "preserved", style: "preserved", logic: `on submit { go_to_scene(${JSON.stringify(branch)}); }` },
      pvoCompiled: { structure: { type: "form", fields: [], submit: "Send" }, rules: [{ event: "submit", target: null, action: target }] },
    },
  });
  assert.equal(sceneRouteLabel(useCapture.getState().scenes, branch), "Send");
  assert.deepEqual(deletionImpact(useCapture.getState().scenes, branch)[0].outcomes,
    ["Send · success", "Send · error", "Saved PVO Logic"]);
  state.deleteScene(branch);
  const component = useCapture.getState().components[0];
  assert.deepEqual(component.fields.successOutcome, { kind: "continue" });
  assert.deepEqual(component.fields.failureOutcome, { kind: "continue" });
  assert.deepEqual(component.archivedCode.pvoCompiled.rules[0].action, { kind: "continue" });
  assert.match(component.archivedCode.pvo.logic, /continue\(\)/);
});

test("duplicate requests reference copied forms and responses while retaining literal prose", () => {
  const state = start();
  const originalScene = state.createScene();
  const formId = state.addComponent("form");
  const cardId = state.addComponent("card");
  const request = {
    kind: "request", method: "POST", url: `https://example.com/{state.form.${formId}.name_0}`,
    body: JSON.stringify({ name: `{state.form.${formId}.name_0}`, saved: `{state.responses.${cardId}.ok}`, prose: formId, external: "{state.form.external.name}" }),
    onSuccess: { kind: "continue" }, onError: null,
  };
  const code = {
    custom: true,
    pvo: { structure: `Literal ${formId}`, style: "", logic: `on press(send) { request(${JSON.stringify(request)}); }` },
    pvoCompiled: { structure: { type: "card", title: "Send", body: null, buttons: [{ id: "send", label: "Send" }] }, rules: [{ event: "press", target: "send", action: request }] },
  };
  state.updateComponent(cardId, { fields: { buttons: [{ label: "Send", outcome: request }] }, code, archivedCode: code });
  const copyId = state.duplicateScene(originalScene);
  const copied = useCapture.getState().scenes.find(item => item.id === copyId);
  const copiedFormId = copied.components[0].id;
  const copiedCard = copied.components[1];
  for (const outcome of [copiedCard.fields.buttons[0].outcome, copiedCard.code.pvoCompiled.rules[0].action, copiedCard.archivedCode.pvoCompiled.rules[0].action]) {
    assert.equal(outcome.url, `https://example.com/{state.form.${copiedFormId}.name_0}`);
    assert.deepEqual(JSON.parse(outcome.body), {
      name: `{state.form.${copiedFormId}.name_0}`, saved: `{state.responses.${copiedCard.id}.ok}`,
      prose: formId, external: "{state.form.external.name}",
    });
  }
  assert.ok(copiedCard.code.pvo.logic.includes(`{state.form.${copiedFormId}.name_0}`));
  assert.ok(copiedCard.archivedCode.pvo.logic.includes(`{state.responses.${copiedCard.id}.ok}`));
  assert.equal(copiedCard.code.pvo.structure, `Literal ${formId}`);
  assert.equal(useCapture.getState().scenes.find(item => item.id === originalScene).components[1].fields.buttons[0].outcome.url, request.url);
});
