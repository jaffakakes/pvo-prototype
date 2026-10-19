import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `
  export * from './editor/src/domain/components/design.ts';
  export { createLook } from './editor/src/domain/components/look.ts';
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
  editComponentDesign,
  designColour,
  tintColour,
  solidColour,
  recolourBackground,
  createLook,
  useCapture,
  mkClip,
  initial,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const component = () => ({
  id: "test",
  sceneId: "main",
  type: "card",
  at: 0,
  dur: 3,
  x: 50,
  y: 50,
  fields: {
    title: "Choose",
    buttons: [
      { label: "Next", outcome: { kind: "time", t: 2 } },
      { label: "Stay", outcome: { kind: "continue" } },
    ],
  },
  look: createLook("bold", 2),
});

test("a design colour belongs only to its selected control", () => {
  const before = component();
  const changes = editComponentDesign(before, "button:1", {
    kind: "background",
    value: "#123456",
  });
  assert.equal(changes.look.btns[1].fill, "#123456");
  assert.deepEqual(changes.look.btns[0], before.look.btns[0]);
  assert.deepEqual(changes.look.whole, before.look.whole);
  assert.equal(
    designColour({ ...before, ...changes }, "button:1", "background"),
    "#123456",
  );
  assert.equal(before.look.preset, "bold");
});

test("whole text colour changes its heading and body, preserving button colours and routes", () => {
  const before = component();
  const changes = editComponentDesign(before, "whole", {
    kind: "text",
    value: "#abcdef",
  });
  assert.equal(changes.look.whole.text, "#ABCDEF");
  assert.equal(changes.look.heading.color, "#ABCDEF");
  assert.equal(changes.look.body.color, "#ABCDEF");
  assert.deepEqual(changes.look.btns, before.look.btns);
  assert.equal(changes.fields, undefined);
});

test("a broken source draft rejects presets and individual edits", () => {
  const draft = { ...component(), code: { custom: true, pvoTouched: true } };
  assert.equal(
    editComponentDesign(draft, "whole", { kind: "preset", value: "soft" }),
    null,
  );
  assert.equal(
    editComponentDesign(draft, "body", { kind: "size", value: "L" }),
    null,
  );
});

test("a design preset is one reversible edit without changing content or timing", () => {
  const state = initial();
  state.scenes[0].clips = [mkClip(6, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  const s = useCapture.getState();
  const id = s.addComponent("form");
  const before = structuredClone(useCapture.getState().components[0]);
  const count = useCapture.getState().past.length;
  s.updateComponent(
    id,
    editComponentDesign(before, "whole", { kind: "preset", value: "soft" }),
  );
  assert.equal(useCapture.getState().past.length, count + 1);
  assert.equal(useCapture.getState().components[0].look.preset, "soft");
  assert.deepEqual(useCapture.getState().components[0].fields, before.fields);
  s.undo();
  assert.deepEqual(
    JSON.parse(JSON.stringify(useCapture.getState().components[0])),
    before,
  );
});

test("tint stores a supported colour token", () => {
  assert.equal(tintColour("#123456"), "rgba(18, 52, 86, 0.2)");
});

test("tint survives normalization and rejects injected or out-of-range colour data", () => {
  const changes = editComponentDesign(component(), "whole", {
    kind: "background",
    value: tintColour("#123456"),
  });
  assert.equal(changes.look.whole.bg, "rgba(18, 52, 86, 0.2)");
  for (const value of [
    "rgba(256, 0, 0, .2)",
    "rgba(0, 0, 0, 2)",
    "rgba(0, 0, 0, .2);color:red",
  ]) {
    const next = editComponentDesign(component(), "whole", {
      kind: "background",
      value,
    });
    assert.equal(next.look.whole.bg, component().look.whole.bg);
  }
});

test("background hue and tint alpha survive kind and colour changes", () => {
  assert.equal(solidColour("rgba(18, 52, 86, 0.4)"), "#123456");
  assert.equal(
    recolourBackground("rgba(18, 52, 86, 0.4)", "#ff2d78"),
    "rgba(255, 45, 120, 0.4)",
  );
  assert.equal(recolourBackground("#123456", "#ff2d78"), "#ff2d78");
});
