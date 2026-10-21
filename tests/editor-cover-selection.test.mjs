import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export { saveProjectCover } from './editor/src/state/editing/coverCommands.ts';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { useCapture, initial, saveProjectCover } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function setup() {
  useCapture.setState(initial());
  useCapture.getState().patch({
    clips: [
      {
        id: 1,
        url: null,
        color: "#ff758f",
        in: 0,
        out: 4,
        srcDur: 4,
        speed: 1,
        zoom: 1,
        mirror: false,
        fit: "contain",
      },
    ],
  });
}

test("saving a cover adds one undoable edit without changing the editor position or selection", () => {
  setup();
  useCapture.getState().patch({ t: 1, sel: 0 });
  saveProjectCover(2.5);
  assert.equal(useCapture.getState().coverAt, 2.5);
  assert.equal(useCapture.getState().past.length, 1);
  assert.equal(useCapture.getState().t, 1);
  assert.equal(useCapture.getState().sel, 0);
  saveProjectCover(2.5);
  assert.equal(useCapture.getState().past.length, 1);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().coverAt, 0);
  useCapture.getState().redo();
  assert.equal(useCapture.getState().coverAt, 2.5);
});

test("cover commands bound the choice to Main and reject invalid times without editing", () => {
  setup();
  saveProjectCover(20);
  assert.equal(useCapture.getState().coverAt, 4 - 1 / 30);
  const saved = useCapture.getState();
  for (const time of [NaN, Infinity, -1])
    assert.throws(() => saveProjectCover(time), /valid cover/);
  assert.equal(useCapture.getState(), saved);
});
