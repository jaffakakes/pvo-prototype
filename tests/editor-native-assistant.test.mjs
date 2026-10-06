import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { parseNativeOperation, parseNativeTurnRequest, parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";

const bundled = buildSync({
  stdin: { resolveDir: process.cwd(), contents: `
    export * from './editor/src/domain/assistant/native/batch.ts';
    export * from './editor/src/domain/assistant/native/context.ts';
    export * from './editor/src/state/assistant/nativeCommands.ts';
    export * from './editor/src/state/editing/audioGainCommands.ts';
    export { initial } from './editor/src/state/project/initial.ts';
    export { projectSnapshot } from './editor/src/state/project/history.ts';
    export { useCapture } from './editor/src/state/captureStore.ts';
    export { useEditorPreferences } from './editor/src/state/preferences/editorPreferences.ts';
  ` }, bundle: true, write: false, format: "esm", platform: "browser",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const clip = { id: 100, url: "blob:private-video", srcDur: 12, in: 2, out: 10, speed: 2,
  color: "#000", zoom: 1, mirror: false, width: 320, height: 240, fit: "contain" };
function reset() {
  api.useCapture.setState(api.initial());
  api.useEditorPreferences.setState({ advancedEditingEnabled: false });
  api.useCapture.getState().patch({ clips: [{ ...clip }, { ...clip, id: 101 }], screen: "editor" });
  return api.projectSnapshot(api.useCapture.getState());
}
function preparation(overrides = {}) {
  let id = 1000;
  return { createId: () => id++, advancedEditingEnabled: false,
    compile: async () => { throw new Error("Unexpected component compilation"); }, ...overrides };
}
const state = () => api.useCapture.getState();
const project = () => api.projectSnapshot(state());
const fingerprint = () => api.nativeProjectFingerprint(project());
const compileTooltip = async (_type, source) => ({ structure: { type: "tooltip", text: source.structure.match(/<text>(.*?)<\/text>/s)?.[1] ?? "" }, rules: [], html: "", css: "", js: "" });

test("native workflow trims accelerated footage, adds styled text and lowers music in one undo", async () => {
  const before = reset();
  const token = fingerprint();
  const batch = await api.prepareNativeBatch(before, [
    { kind: "clip.trim", sceneId: "main", clipId: 100, sourceIn: 4, sourceOut: 10 },
    { kind: "text.add", sceneId: "main", text: "Product launch", start: 2, end: 5, x: 99, style: { fill: "#ff0000", bold: true } },
    { kind: "scene.update", sceneId: "main", changes: { musicGain: 0.2, clipGain: 0.8 } },
    { kind: "playback.seek", sceneId: "main", time: 2 },
  ], preparation());
  assert.deepEqual(project(), before, "Preparation never edits the live project");
  assert.equal(state().past.length, 0);
  assert.equal(api.commitNativeBatch(batch, token, "edit"), true);
  assert.equal(state().past.length, 1);
  assert.equal(state().clips[0].in, 4);
  assert.deepEqual([state().texts[0].start, state().texts[0].end, state().texts[0].x], [2, 5, 92]);
  assert.equal(state().texts[0].style.font, "sans");
  assert.equal(state().texts[0].style.fill, "#ff0000");
  assert.equal(state().scenes[0].musicGain, 0.2);
  assert.equal(batch.playback.length, 1);
  state().undo();
  assert.deepEqual(project(), before);
  state().redo();
  assert.equal(state().texts[0].text, "Product launch");
});

test("one invalid operation or compiler failure rolls the entire batch back", async () => {
  const before = reset();
  const commands = [{ kind: "text.add", sceneId: "main", text: "Never committed", start: 1, end: 3 }];
  await assert.rejects(api.prepareNativeBatch(before, [...commands,
    { kind: "clip.trim", sceneId: "main", clipId: 100, sourceIn: 11, sourceOut: 14 },
  ], preparation()), /inside the source/);
  await assert.rejects(api.prepareNativeBatch(before, [...commands,
    { kind: "component.add", sceneId: "main", componentType: "tooltip", at: 1, duration: 3 },
  ], preparation()), /Unexpected component compilation/);
  assert.deepEqual(project(), before);
  assert.equal(state().past.length, 0);
});

test("stale plans and read-only modes cannot commit while safe preference changes remain valid", async () => {
  const before = reset();
  const token = fingerprint();
  const batch = await api.prepareNativeBatch(before, [{ kind: "project.ratio", ratio: "16:9" }], preparation());
  for (const mode of ["ask", "plan"]) assert.throws(() => api.commitNativeBatch(batch, token, mode), /Only an edit command/);
  api.useEditorPreferences.setState({ advancedEditingEnabled: true });
  assert.doesNotThrow(() => api.validateNativeBatchEditingMode(batch, false));
  api.useEditorPreferences.setState({ advancedEditingEnabled: false });
  state().addText("A newer manual change");
  assert.throws(() => api.commitNativeBatch(batch, token, "edit"), /project changed/);
  assert.equal(state().ratio, "9:16");
  assert.equal(state().texts[0].text, "A newer manual change");
  assert.equal(state().past.length, 1);
});

test("clip and audio operations use source speed, preserve independent audio and restore history", async () => {
  const before = reset();
  const batch = await api.prepareNativeBatch(before, [
    { kind: "audio.extract", sceneId: "main", clipId: 101 },
    { kind: "clip.split", sceneId: "main", clipId: 100, time: 1 },
    { kind: "clip.move", sceneId: "main", clipId: 101, index: 0 },
    { kind: "clip.delete", sceneId: "main", clipId: 101 },
    { kind: "audio.update", sceneId: "main", audioId: 1000, changes: { start: 1, sourceIn: 3, sourceOut: 9, gain: 0.3 } },
    { kind: "audio.split", sceneId: "main", audioId: 1000, time: 2 },
  ], preparation());
  assert.deepEqual(batch.project.scenes[0].clips.map(item => [item.in, item.out]), [[2, 4], [4, 10]]);
  assert.deepEqual(batch.project.scenes[0].audioClips.map(item => [item.start, item.in, item.out, item.gain]), [[1, 3, 5, 0.3], [2, 5, 9, 0.3]]);
  assert.equal(batch.project.scenes[0].audioClips[0].url, clip.url);
  api.commitNativeBatch(batch, fingerprint(), "edit");
  state().undo();
  assert.deepEqual(project(), before);
});

test("scene deletion removes descendants and clears routes like the manual command", async () => {
  reset();
  const child = state().createScene({ name: "Branch" });
  const grandchild = state().createScene({ name: "Details" });
  state().switchScene("main");
  const componentId = state().addComponent("card");
  state().updateOutcome(componentId, { kind: "button", index: 0 }, { kind: "scene", sceneId: grandchild });
  const batch = await api.prepareNativeBatch(project(), [{ kind: "scene.delete", sceneId: child }], preparation());
  assert.deepEqual(batch.project.scenes.map(item => item.id), ["main"]);
  assert.deepEqual(batch.project.scenes[0].components[0].fields.buttons[0].outcome, { kind: "continue" });
  await assert.rejects(api.prepareNativeBatch(project(), [{ kind: "scene.delete", sceneId: "main" }], preparation()), /main scene/);
});

test("component creation and content reuse validated native content/source projection", async () => {
  reset();
  const id = state().addComponent("tooltip");
  const batch = await api.prepareNativeBatch(project(), [
    { kind: "component.content", sceneId: "main", componentId: id, changes: { text: "Updated wording" } },
    { kind: "component.update", sceneId: "main", componentId: id, changes: { at: 2, duration: 4, x: 0, y: 100 } },
    { kind: "component.add", sceneId: "main", componentType: "tooltip", at: 1, duration: 3,
      source: { structure: "<tooltip><text>New note</text></tooltip>", style: "", logic: "" } },
  ], preparation({ compile: compileTooltip }));
  const [updated, added] = batch.project.scenes[0].components;
  assert.equal(updated.fields.text, "Updated wording");
  assert.deepEqual([updated.at, updated.dur, updated.x, updated.y], [2, 4, 8, 94]);
  assert.equal(added.fields.text, "New note");
  assert.equal(added.code.pvoTouched, false);
});

test("timed Choice and answer overlays preserve footage and expose their actual metadata", async () => {
  const before = reset();
  const batch = await api.prepareNativeBatch(before, [
    { kind: "component.add", sceneId: "main", componentType: "choice", at: 1, duration: 3,
      responsePolicy: { dispatch: "interaction", unanswered: "pause" } },
    { kind: "text.add", sceneId: "main", text: "The answer", start: 4, end: 6 },
  ], preparation({ compile: async () => ({ html: "", css: "", js: "",
    structure: { type: "choice", prompt: "Which one?", options: [
      { id: "option0", label: "Option A" }, { id: "option1", label: "Option B" },
    ] },
    rules: [0, 1].map(index => ({ event: "choose", target: `option${index}`, action: { kind: "continue" } })),
  }) }));
  const scene = batch.project.scenes[0];
  assert.deepEqual(scene.clips, before.scenes[0].clips, "Overlay timing needs no split, trim or reordering");
  assert.deepEqual([scene.components[0].at, scene.components[0].dur], [1, 3]);
  assert.deepEqual(scene.components[0].responsePolicy, { dispatch: "interaction", unanswered: "pause" });
  assert(scene.components[0].fields.options.every(option => option.outcome.kind === "continue"));
  const context = api.nativeProjectContext(batch.project, 0);
  assert.equal(context.scenes[0].components[0].id, scene.components[0].id);
  assert.equal(context.scenes[0].texts[0].id, scene.texts[0].id);
  assert.deepEqual([context.scenes[0].texts[0].start, context.scenes[0].texts[0].end], [4, 6]);
  assert.ok(context.scenes[0].components[0].source, "Current component source is available without a media observation");
});

test("native context excludes media URLs, request bodies and unfinished source", () => {
  reset();
  const id = state().addComponent("card");
  state().updateOutcome(id, { kind: "button", index: 0 }, {
    kind: "request", url: "https://secret.example/api?token=hidden", method: "POST", body: '{"password":"secret"}', onSuccess: { kind: "continue" }, onError: null,
  });
  const context = api.nativeProjectContext(project(), 2);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /blob:|secret|password|hidden/);
  assert.equal(context.scenes[0].components[0].source, undefined);
  assert.equal(context.scenes[0].clips[1].start, 4);
  assert.doesNotThrow(() => parseNativeTurnRequest({ mode: "ask", prompt: "Describe it", history: [], project: context, observations: [] }));
});

test("native quiz response policy survives preparation, context, commit and Undo", async () => {
  reset();
  const id = state().addComponent("choice");
  const before = project();
  const token = fingerprint();
  const policy = { dispatch: "interaction", unanswered: "pause" };
  const batch = await api.prepareNativeBatch(before, [
    { kind: "component.update", sceneId: "main", componentId: id,
      changes: { at: 1.5, duration: 0.5, responsePolicy: policy } },
  ], preparation());
  assert.deepEqual(project(), before, "Preparing a pause does not alter live playback");
  const choice = batch.project.scenes[0].components[0];
  assert.equal(choice.at + choice.dur, 2, "The boundary is before the punchline, not the layer start");
  assert.deepEqual(choice.responsePolicy, policy);
  assert.deepEqual(api.nativeProjectContext(batch.project, 0).scenes[0].components[0].responsePolicy, policy);
  assert.doesNotThrow(() => parseNativeTurnRequest({ mode: "edit", prompt: "Wait for my guess",
    history: [], project: api.nativeProjectContext(batch.project, 0), observations: [] }));
  api.commitNativeBatch(batch, token, "edit");
  assert.deepEqual(state().components[0].responsePolicy, policy);
  state().undo();
  assert.deepEqual(project(), before);
  state().redo();
  assert.deepEqual(state().components[0].responsePolicy, policy);
});

test("native pause requests cannot create a display-only or buttonless dead end", async () => {
  reset();
  const noteId = state().addComponent("tooltip");
  const cardId = state().addComponent("card");
  state().updateComponent(cardId, { fields: { title: "No answer", body: "", buttons: [] } });
  const before = project();
  for (const [componentId, message] of [[noteId, /Notes cannot define/], [cardId, /needs a button/]]) {
    await assert.rejects(api.prepareNativeBatch(before, [
      { kind: "text.add", sceneId: "main", text: "Never applied", start: 0, end: 1 },
      { kind: "component.update", sceneId: "main", componentId,
        changes: { responsePolicy: { dispatch: "interaction", unanswered: "pause" } } },
    ], preparation()), message);
  }
  assert.deepEqual(project(), before);
});

test("native operations reject extra effects and cancellation leaves all state untouched", async () => {
  assert.throws(() => parseNativeOperation({ kind: "scene.update", sceneId: "main", changes: { allowedDomains: ["evil.test"] } }), /unsupported/);
  assert.throws(() => parseNativeOperation({ kind: "clip.update", sceneId: "main", clipId: 100, changes: { url: "https://evil.test" } }), /unsupported/);
  assert.throws(() => parseNativeOperation({ kind: "audio.update", sceneId: "main", audioId: 1, changes: { gain: Infinity } }), /range/);
  assert.throws(() => parseNativeTurnResult({ message: "Ready", operations: [], observations: [{ kind: "frames", sceneId: "main", start: 5, end: 1, count: 2 }] }), /end precedes/);
  const before = reset();
  const flag = { aborted: false };
  await assert.rejects(api.prepareNativeBatch(before, [
    { kind: "text.add", sceneId: "main", text: "Pending", start: 0, end: 2 },
    { kind: "component.add", sceneId: "main", componentType: "tooltip", at: 0, duration: 2 },
  ], preparation({ signal: flag, compile: async (...args) => { flag.aborted = true; return compileTooltip(...args); } })), { name: "AbortError" });
  assert.deepEqual(project(), before);
});

test("duplicating a scene gives media and overlays independent IDs and export remains a host request", async () => {
  reset();
  state().addText("Shared media, independent edits");
  const before = project();
  const batch = await api.prepareNativeBatch(before, [
    { kind: "scene.duplicate", sceneId: "main" },
    { kind: "export.prepare", format: "pvo" },
  ], preparation());
  assert.equal(batch.project.scenes.length, 2);
  const [main, copy] = batch.project.scenes;
  assert.equal(copy.parent, "main");
  assert.equal(copy.clips[0].url, main.clips[0].url);
  assert.notEqual(copy.clips[0].id, main.clips[0].id);
  assert.notEqual(copy.texts[0].id, main.texts[0].id);
  assert.equal(batch.exportFormat, "pvo");
  assert.equal(state().ex, "idle", "Preparing export cannot publish or render by itself");
  assert.deepEqual(project(), before);
});

test("trimming footage cannot leave an existing component jump outside the final timeline", async () => {
  reset();
  const id = state().addComponent("card");
  state().updateOutcome(id, { kind: "button", index: 0 }, { kind: "time", t: 7 });
  const before = project();
  await assert.rejects(api.prepareNativeBatch(before, [
    { kind: "clip.delete", sceneId: "main", clipId: 101 },
    { kind: "clip.trim", sceneId: "main", clipId: 100, sourceIn: 2, sourceOut: 6 },
  ], preparation()), /outside/);
  assert.deepEqual(project(), before);
});

test("native source proposals cannot introduce network actions even with Advanced enabled", async () => {
  reset();
  const id = state().addComponent("card");
  const before = project();
  const structure = { type: "card", title: "Title", body: "Body", buttons: [{ id: "button0", label: "Continue" }] };
  let compiled = 0;
  await assert.rejects(api.prepareNativeBatch(before, [{ kind: "component.source", sceneId: "main", componentId: id,
    source: { structure: "<card><button>Continue</button></card>", style: "", logic: "untrusted request" },
  }], preparation({ advancedEditingEnabled: true, compile: async () => ({
    structure, html: "", css: "", js: "", rules: [{ event: "press", target: "button0", action: ++compiled === 1 ? { kind: "continue" } : {
      kind: "request", url: "https://example.com", method: "GET", body: "", onSuccess: { kind: "continue" }, onError: null,
    } }],
  }) })), /Configure request actions/);
  assert.deepEqual(project(), before);
});

test("component source drafts and active recording or importing block mutation", async () => {
  reset();
  const id = state().addComponent("tooltip");
  state().updateComponent(id, { code: { custom: true, pvoTouched: true, pvo: { structure: "unfinished", style: "", logic: "" } } });
  await assert.rejects(api.prepareNativeBatch(project(), [{ kind: "component.content", sceneId: "main", componentId: id, changes: { text: "replace" } }], preparation()), /Finish or discard/);
  for (const blocked of [{ importing: true }, { recording: true }, { screen: "camera" }, { trim: { i: 0, side: "l", shift: 0, lt: 2 } }]) {
    reset();
    const before = project();
    const token = fingerprint();
    const batch = await api.prepareNativeBatch(before, [{ kind: "project.ratio", ratio: "1:1" }], preparation());
    state().patch(blocked);
    assert.throws(() => api.commitNativeBatch(batch, token, "edit"), /Finish recording/);
    assert.equal(state().ratio, "9:16");
  }
});

test("native content changes preserve existing request destinations and payloads byte-for-byte", async () => {
  reset();
  const id = state().addComponent("card");
  const action = { kind: "request", url: "https://example.com/submit", method: "POST", body: '{"value":"{state.answer}"}', onSuccess: { kind: "continue" }, onError: null };
  state().updateOutcome(id, { kind: "button", index: 0 }, action);
  const before = project();
  const sources = [];
  const batch = await api.prepareNativeBatch(before, [{ kind: "component.content", sceneId: "main", componentId: id, changes: { title: "Updated heading" } }], preparation({
    compile: async (_kind, source) => {
      sources.push(source);
      return { html: "", css: "", js: "", structure: { type: "card", title: source.structure.match(/<title>(.*?)<\/title>/s)?.[1], body: "Add a line of text.", buttons: [{ id: "button0", label: "Got it" }] },
        rules: [{ event: "press", target: "button0", action: structuredClone(action) }] };
    },
  }));
  assert.equal(batch.project.scenes[0].components[0].fields.title, "Updated heading");
  assert.deepEqual(batch.project.scenes[0].components[0].fields.buttons[0].outcome, action);
  assert.equal(sources[0].logic, sources[1].logic);
  assert.deepEqual(project(), before);
});

test("native and manual gain edits share history grouping and extracted audio retains clip gain", async () => {
  reset();
  api.setSceneAudioGain("main", "clip", 0.4);
  api.setSceneAudioGain("main", "music", 0.2);
  api.setSceneAudioGain("main", "music", 0.1, false);
  assert.equal(state().past.length, 2);
  assert.equal(state().scenes[0].musicGain, 0.1);
  const batch = await api.prepareNativeBatch(project(), [{ kind: "audio.extract", sceneId: "main", clipId: 100 }], preparation());
  assert.equal(batch.project.scenes[0].audioClips[0].gain, 0.4);
  api.commitNativeBatch(batch, fingerprint(), "edit");
  api.setAudioClipGain("main", 1000, 0.6);
  api.setAudioClipGain("main", 1000, 0.7, false);
  assert.equal(state().audioClips[0].gain, 0.7);
  state().undo();
  assert.equal(state().audioClips[0].gain, 0.4);
});

test("style-only operations retain private request Logic while context exposes a harmless design surrogate", async () => {
  reset();
  const id = state().addComponent("card");
  const action = { kind: "request", url: "https://private.example/key", method: "POST", body: '{"private":"{state.answer}"}', onSuccess: { kind: "time", t: 1 }, onError: null };
  state().updateOutcome(id, { kind: "button", index: 0 }, action);
  const before = project();
  const context = api.nativeProjectContext(before, 0);
  const target = context.scenes[0].components[0];
  assert.equal(target.source, undefined);
  assert.match(target.design.logic, /on press\(button0\) \{ continue\(\); \}/);
  assert.doesNotMatch(JSON.stringify(context), /private|https:|state.answer/);
  const sources = [];
  const batch = await api.prepareNativeBatch(before, [{ kind: "component.style", sceneId: "main", componentId: id, style: "card { background: #123456; }" }], preparation({
    compile: async (_kind, source) => {
      sources.push(source);
      return { html: "", css: source.style.includes("#123456") ? "new" : "old", js: "", structure: { type: "card", title: "New message", body: "Add a line of text.", buttons: [{ id: "button0", label: "Got it" }] },
        rules: [{ event: "press", target: "button0", action: structuredClone(action) }] };
    },
  }));
  const result = batch.project.scenes[0].components[0];
  assert.equal(result.code.pvo.logic, sources[0].logic);
  assert.equal(result.code.pvo.structure, sources[0].structure);
  assert.match(result.code.pvo.style, /#123456/);
  assert.deepEqual(result.fields.buttons[0].outcome, action);
  assert.deepEqual(project(), before);
});

test("native context accepts the editor's minimum clip scale and rejects unsaveable extracted-audio speeds", async () => {
  reset();
  state().patch({ clips: state().clips.map(clip => ({ ...clip, zoom: 0.5, speed: 0.25 })) });
  assert.doesNotThrow(() => parseNativeTurnRequest({ mode: "plan", prompt: "Describe this", history: [], observations: [], project: api.nativeProjectContext(project(), 0) }));
  assert.throws(() => parseNativeOperation({ kind: "clip.update", sceneId: "main", clipId: 100, changes: { speed: 0.1 } }), /range/);
  assert.throws(() => parseNativeOperation({ kind: "component.update", sceneId: "main", componentId: "x", changes: { scale: 4 } }), /range/);
});

test("native clip reorder preserves selected identity and deleting that clip clears selection", async () => {
  reset();
  state().patch({ sel: 1 });
  const moved = await api.prepareNativeBatch(project(), [{ kind: "clip.move", sceneId: "main", clipId: 101, index: 0 }], preparation());
  api.commitNativeBatch(moved, fingerprint(), "edit");
  assert.equal(state().sel, 0);
  assert.equal(state().clips[state().sel].id, 101);
  const deleted = await api.prepareNativeBatch(project(), [{ kind: "clip.delete", sceneId: "main", clipId: 101 }], preparation());
  api.commitNativeBatch(deleted, fingerprint(), "edit");
  assert.equal(state().sel, -1);
  assert.equal(state().clips[0].id, 100);
});

test("commit rechecks advanced behavior while allowing harmless changes after a preference change", async () => {
  reset();
  const id = state().addComponent("card");
  const before = project();
  const safe = await api.prepareNativeBatch(before, [{ kind: "project.ratio", ratio: "1:1" }], preparation({ advancedEditingEnabled: true }));
  const unsafe = structuredClone(safe);
  unsafe.project.scenes[0].components.find(component => component.id === id).fields.buttons[0].outcome = {
    kind: "request", url: "https://example.com", method: "GET", body: "", onSuccess: { kind: "continue" }, onError: null,
  };
  assert.throws(() => api.validateNativeBatchEditingMode(unsafe, false), /Enable Advanced/);
  assert.throws(() => api.commitNativeBatch(unsafe, fingerprint(), "edit"), /Enable Advanced/);
  assert.deepEqual(project(), before);
  assert.equal(api.commitNativeBatch(safe, fingerprint(), "edit"), true);
  assert.equal(state().ratio, "1:1");
});

test("merged batches cannot retain a seek into a deleted or shortened scene", async () => {
  for (const scenario of ["deleted", "shortened"]) {
    reset();
    if (scenario === "deleted") {
      const main = state().scenes[0];
      state().patch({ scenes: [main, { ...structuredClone(main), id: "child", parent: "main", name: "Branch" }] });
    }
    const before = project();
    const original = await api.prepareNativeBatch(before, [{ kind: "playback.seek",
      sceneId: scenario === "deleted" ? "child" : "main", time: 7 }], preparation());
    const followUp = await api.prepareNativeBatch(original.project, [scenario === "deleted"
      ? { kind: "scene.delete", sceneId: "child" }
      : { kind: "clip.delete", sceneId: "main", clipId: 101 }], preparation());
    const combined = { ...followUp, before, operations: [...original.operations, ...followUp.operations],
      playback: [...original.playback, ...followUp.playback] };
    assert.throws(() => api.validateNativeBatchEffects(combined), /requested playback position/, scenario);
    assert.throws(() => api.commitNativeBatch(combined, fingerprint(), "edit"), /requested playback position/, scenario);
    assert.deepEqual(project(), before);
    assert.equal(state().past.length, 0);
  }
});

test("merged batches cannot retain export preparation after removing all authored content", async () => {
  const before = reset();
  const original = await api.prepareNativeBatch(before, [{ kind: "export.prepare", format: "pvo" }], preparation());
  const followUp = await api.prepareNativeBatch(original.project, [
    { kind: "clip.delete", sceneId: "main", clipId: 100 },
    { kind: "clip.delete", sceneId: "main", clipId: 101 },
  ], preparation());
  const combined = { ...followUp, before, operations: [...original.operations, ...followUp.operations],
    exportFormat: original.exportFormat };
  assert.throws(() => api.validateNativeBatchEffects(combined), /before exporting/);
  assert.throws(() => api.commitNativeBatch(combined, fingerprint(), "edit"), /before exporting/);
  assert.deepEqual(project(), before);
  assert.equal(state().past.length, 0);
});
