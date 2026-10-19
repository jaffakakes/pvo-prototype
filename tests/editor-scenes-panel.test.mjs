import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
const bundle = buildSync({
  stdin: {
    contents: `
export { sceneGraph } from './editor/src/domain/scenes/graph.ts';
export { sceneMapLayout } from './editor/src/features/scenes/sceneMapLayout.ts';
export { createSceneBranch } from './editor/src/state/scenes/createSceneBranch.ts';
export { useCapture, mkClip } from './editor/src/store.ts';
export { initial } from './editor/src/state/project/initial.ts';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  sceneGraph,
  sceneMapLayout,
  createSceneBranch,
  useCapture,
  mkClip,
  initial,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("adding a branch preserves authored routes and undoes the new choice and child together", () => {
  useCapture.setState(initial());
  useCapture
    .getState()
    .patch({ screen: "editor", clips: [mkClip(6, null, 0)] });
  const originalId = useCapture.getState().addComponent("choice");
  const original = structuredClone(useCapture.getState().components[0]);
  const before = useCapture.getState().past.length;
  const childId = createSceneBranch();
  const state = useCapture.getState();
  assert.equal(state.past.length, before + 1);
  assert.equal(state.currentSceneId, childId);
  assert.equal(state.scenes[1].parent, "main");
  assert.equal(state.clips.length, 0);
  assert.deepEqual(
    state.scenes[0].components.find((component) => component.id === originalId),
    original,
  );
  assert.deepEqual(state.scenes[0].components[1].fields.options[0].outcome, {
    kind: "scene",
    sceneId: childId,
  });
  assert.equal(state.scenes[0].components[1].fields.options.length, 2);
  state.undo();
  assert.equal(useCapture.getState().scenes.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(useCapture.getState().components)),
    JSON.parse(JSON.stringify([original])),
  );
  useCapture.getState().redo();
  assert.equal(useCapture.getState().scenes[0].components.length, 2);
  assert.equal(useCapture.getState().currentSceneId, childId);
});

test("tree and map describe exact choices, multiple routes, empty children and deeper branches", () => {
  const root = { ...initial().scenes[0], clips: [mkClip(6, null, 0)] };
  const child = {
    ...initial().scenes[0],
    id: "a",
    name: "Scene A",
    parent: "main",
  };
  const leaf = {
    ...initial().scenes[0],
    id: "i",
    name: "Scene i",
    parent: "a",
  };
  root.components = [
    {
      id: "choice",
      type: "choice",
      sceneId: "main",
      fields: {
        options: [
          { label: "Buy the set", outcome: { kind: "scene", sceneId: "a" } },
          { label: "Show me", outcome: { kind: "scene", sceneId: "a" } },
        ],
      },
    },
  ];
  const nodes = sceneGraph([leaf, child, root]);
  assert.deepEqual(
    nodes.map((node) => node.scene.id),
    ["main", "a", "i"],
  );
  assert.deepEqual(
    nodes[1].reachedBy.map((route) => route.label),
    ["Buy the set", "Show me"],
  );
  assert.deepEqual(
    nodes[2].reachedBy,
    [],
    "Unrouted scenes must not get an invented choice label",
  );
  assert.equal(nodes[1].duration, 0);
  assert.equal(nodes[1].children.length, 1);
  const hop = sceneMapLayout(nodes, "a", false);
  assert.deepEqual(hop.scenes.map((entry) => entry.node.scene.id).sort(), [
    "a",
    "i",
    "main",
  ]);
  assert(hop.edges.some((edge) => edge.label === "Buy the set"));
  assert(hop.scenes.every((entry) => entry.y >= 0));
  const fit = sceneMapLayout(nodes, "a", true);
  assert.equal(fit.scenes.length, 3);
  assert(fit.frame.width > 0 && fit.frame.height > 0);
  assert.equal(fit.choices.length, 1);
});
