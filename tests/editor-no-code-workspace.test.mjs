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
  aspectRatioPanelHeight,
  editorPanelHeight,
  workspaceGeometry,
  toolTrayLayout,
  startTry,
  stopTry,
  runComponentResponse,
  advanceTry,
  useCapture,
  mkClip,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("tray layout follows measured controls and toolbar, including safe areas and larger content", () => {
  const size = { height: 844, header: 56, controls: 150, toolbar: 76 };
  const normal = editorPanelHeight(size);
  const baseline = toolTrayLayout(size, normal).panelHeight;
  assert.equal(
    toolTrayLayout({ ...size, controls: 170, toolbar: 96 }, normal).panelHeight,
    baseline,
  );
  assert(toolTrayLayout({ ...size, controls: 250 }, normal).panelHeight > baseline);
  const short = toolTrayLayout({ ...size, height: 393, controls: 150 }, normal);
  assert.equal(short.header, 0, "Short screens give navigation space to the timeline");
  assert(short.panelHeight - Math.min(150, short.controlsMaxHeight) >= 180, "The movie strip stays usable");
  assert(393 - short.panelHeight >= 64, "Preview close remains reachable");
  assert.equal(toolTrayLayout({ ...size, height: 50 }, normal).panelHeight, 0);
});

test("timeline and editing panels split the space below the project header", () => {
  for (const height of [0, 64, 180, 328, 568, 693, 844, 932, 1100]) {
    const measurements = { height, header: 64 };
    const panel = editorPanelHeight(measurements);
    const layout = workspaceGeometry(measurements, panel, false);
    assert.equal(layout.header + layout.preview + panel, height);
    if (height >= 500) assert.equal(layout.preview, (panel * 5) / 3);
    if (height >= 328 && height < 500) assert(layout.preview >= 40);
    assert.ok(panel >= 0);
    if (height >= 328) {
      assert.equal(layout.header, 64);
      assert.equal(layout.previewVisible, true);
      assert.equal(layout.headerOpacity, 1);
    }
  }
});

test("keyboard and orientation changes preserve controls and a usable timeline", () => {
  const measurements = { height: 844, header: 64 };
  const original = editorPanelHeight(measurements);
  const keyboard = editorPanelHeight({ ...measurements, height: 608 });
  const landscape = editorPanelHeight({ ...measurements, height: 390 });
  assert.equal(original - keyboard, (236 * 3) / 8);
  assert(
    landscape >= 200,
    "Short screens reserve room for timeline navigation",
  );
  assert(
    workspaceGeometry({ ...measurements, height: 390 }, landscape, false)
      .preview >= 40,
  );
  assert.equal(editorPanelHeight(measurements), original);
});

test("ratio controls reserve their own row below an exposed timeline", () => {
  for (const height of [390, 568, 844, 932]) {
    const measurements = { height, header: 64 };
    const panel = editorPanelHeight(measurements, true);
    assert(panel - aspectRatioPanelHeight(height) >= 132);
    const layout = workspaceGeometry(measurements, panel, false);
    assert(layout.preview > 0);
    assert.equal(layout.header, 64);
  }
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
    music: null,
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
