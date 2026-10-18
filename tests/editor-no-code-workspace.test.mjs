import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
    export * from "./editor/src/features/editor-layout/workspaceGeometry.ts";
    export * from "./editor/src/features/preview/tryMode.ts";
    export * from "./editor/src/store.ts";
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  editorPanelHeight,
  workspaceGeometry,
  startTry,
  stopTry,
  runComponentResponse,
  advanceTry,
  useCapture,
  mkClip,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("timeline and editing panels leave three quarters for playback with overlay navigation", () => {
  for (const height of [0, 180, 328, 568, 693, 844, 932, 1100]) {
    const measurements = { height, header: 0, playback: 52 };
    const panel = editorPanelHeight(measurements);
    const layout = workspaceGeometry(measurements, panel, false);
    assert.equal(
      layout.header + layout.preview + layout.playback + panel,
      height,
    );
    assert.equal(layout.preview + layout.playback, panel * 3);
    assert.ok(panel >= 0);
    if (height >= 328) {
      assert.equal(layout.header, 0);
      assert.equal(layout.playback, 52);
      assert.equal(layout.previewVisible, true);
      assert.equal(layout.headerOpacity, 1);
      assert.equal(layout.playbackOpacity, 1);
    }
  }
});

test("short timelines return unused space to the player while tall timelines stay capped", () => {
  const measurements = { height: 977, header: 0, playback: 52 };
  assert.equal(editorPanelHeight(measurements, 214), 214);
  assert.equal(editorPanelHeight(measurements, 500), 977 / 4);
  assert.equal(editorPanelHeight(measurements, 0), 977 / 4);
  assert.equal(
    editorPanelHeight({ ...measurements, height: 390 }, 214),
    390 / 4,
  );
});

test("keyboard and orientation height changes recalculate the same fixed split", () => {
  const measurements = { height: 844, header: 0, playback: 52 };
  const original = editorPanelHeight(measurements);
  const keyboard = editorPanelHeight({ ...measurements, height: 608 });
  const landscape = editorPanelHeight({ ...measurements, height: 390 });
  assert.equal(original - keyboard, 236 / 4);
  assert.equal(landscape, 390 / 4);
  assert.equal(editorPanelHeight(measurements), original);
});

function editingProject() {
  stopTry();
  const clips = [mkClip(8, null, 0)];
  const scene = (id, name) => ({
    id,
    name,
    clips,
    texts: [],
    components: [],
    muted: false,
    sound: 0,
    layers: ["video"],
  });
  useCapture.setState({
    scenes: [scene("main", "Main"), scene("branch", "Branch")],
    currentSceneId: "main",
    clips,
    components: [],
    texts: [],
    layers: ["video"],
    screen: "editor",
    t: 2,
    sel: -1,
    selComp: null,
    selText: null,
    sheet: null,
    tryMode: null,
    past: [],
    future: [],
  });
  const id = useCapture.getState().addComponent("choice");
  useCapture.getState().patch({ sheet: "component", t: 2 });
  return id;
}

test("Try preserves the editing session and Stop restores it after visiting another scene", async () => {
  const id = editingProject();
  const component = useCapture
    .getState()
    .components.find((item) => item.id === id);
  const history = useCapture.getState().past;
  startTry();
  assert.equal(useCapture.getState().sheet, "component");
  assert.equal(useCapture.getState().selComp, id);
  await runComponentResponse(component, {
    index: 0,
    outcome: { kind: "scene", sceneId: "branch" },
  });
  assert.equal(useCapture.getState().currentSceneId, "branch");
  stopTry();
  const restored = useCapture.getState();
  assert.equal(restored.currentSceneId, "main");
  assert.equal(restored.t, 2);
  assert.equal(restored.selComp, id);
  assert.equal(restored.sheet, "component");
  assert.strictEqual(restored.past, history);
  assert.equal(restored.tryMode, null);
  assert.equal(restored.playing, false);
});

test("reaching the end of Try returns to the same editing location", () => {
  const id = editingProject();
  startTry();
  const state = useCapture.getState();
  state.patch({ t: 7.9, tryMode: { ...state.tryMode, handled: [id] } });
  advanceTry(useCapture.getState(), 8);
  assert.equal(useCapture.getState().t, 2);
  assert.equal(useCapture.getState().selComp, id);
  assert.equal(useCapture.getState().sheet, "component");
  assert.equal(useCapture.getState().tryMode, null);
});
