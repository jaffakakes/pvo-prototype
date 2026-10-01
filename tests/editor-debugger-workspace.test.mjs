import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: { contents: `
    export * from "./editor/src/features/editor-layout/debugging/debugPanelGeometry.ts";
    export * from "./editor/src/features/editor-layout/debugging/debugCommands.ts";
    export * from "./editor/src/features/try-debugger/uiStore.ts";
    export * from "./editor/src/state/components/componentAuthoringStore.ts";
    export * from "./editor/src/features/preview/tryMode.ts";
    export * from "./editor/src/store.ts";
  `, resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("mobile debugger matches handoff sizes and always retains player and controls", () => {
  for (const [height, expected] of [[693, 281], [844, 360], [932, 404]]) {
    const available = height - 44 - 56 - 52;
    const geometry = api.mobileDebugPanelGeometry(available);
    assert.equal(geometry.initial, expected);
    assert.equal(available - geometry.maximum, 150);
    assert.equal(available - geometry.expanded, 180);
    assert(geometry.initial >= geometry.minimum);
  }
  assert.deepEqual(api.mobileDebugPanelGeometry(80), { minimum: 0, initial: 0, expanded: 0, maximum: 0 });
});

test("desktop debugger keeps a 300px player region and respects compact height", () => {
  const normal = api.desktopDebugPanelGeometry(820, 900);
  assert.equal(normal.initial, 364);
  assert.equal(normal.maximum, 512);
  const compact = api.desktopDebugPanelGeometry(680, 768);
  assert.equal(compact.initial, 768 * .42);
  assert.equal(compact.minimum, 260);
  assert.equal(api.desktopDebugPanelGeometry(280, 400).maximum, 0);
});

test("Stop and edit restores Try then selects the executed component and Logic without project edits", () => {
  api.stopTry();
  const clips = [api.mkClip(10, null, 0)];
  const scene = id => ({ id, name: id, clips, texts: [], components: [], muted: false, sound: 0, layers: ["video"] });
  api.useCapture.setState({ scenes: [scene("main"), scene("branch")], currentSceneId: "main", clips,
    components: [], texts: [], layers: ["video"], screen: "editor", t: 1, sel: -1,
    selComp: null, selText: null, sheet: null, tryMode: null, past: [], future: [] });
  const id = api.useCapture.getState().addComponent("choice");
  api.useCapture.getState().patch({ sheet: null });
  const history = api.useCapture.getState().past;
  api.startTry();
  api.setDebugOpen(true);
  api.editDebugComponent(id, "logic");
  assert.equal(api.useCapture.getState().tryMode, null);
  assert.equal(api.useCapture.getState().selComp, id);
  assert.equal(api.useCapture.getState().sheet, "component");
  assert.strictEqual(api.useCapture.getState().past, history);
  assert.equal(api.useComponentAuthoring.getState().tab, "advanced");
  assert.equal(api.useComponentAuthoring.getState().sourcePart, "logic");
  assert.equal(api.useDebugUi.getState().open, false);
});

test("opening an old deleted component does not stop or mutate the current editing session", () => {
  const previous = api.useCapture.getState();
  api.editDebugComponent("deleted-component", "action");
  assert.strictEqual(api.useCapture.getState(), previous);
  assert.match(api.useDebugUi.getState().feedback, /no longer/);
});
