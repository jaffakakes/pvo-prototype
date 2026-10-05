import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../packages/pvo-language/index.js";

initSync({
  module: new WebAssembly.Module(
    await readFile(
      new URL(
        "../packages/pvo-language/pkg/pvo_language_bg.wasm",
        import.meta.url,
      ),
    ),
  ),
});
const bundle = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
  export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';
  export { nativeProjectContext } from './editor/src/domain/assistant/native/context.ts';
`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const project = () => ({
  currentSceneId: "main",
  ratio: "9:16",
  allowedDomains: [],
  scenes: [
    {
      id: "main",
      name: "Main",
      parent: null,
      muted: false,
      sound: 0,
      texts: [],
      components: [],
      audioClips: [],
      clips: [
        {
          id: 10,
          url: null,
          srcDur: 6,
          in: 0,
          out: 6,
          speed: 1,
          zoom: 1,
          mirror: false,
          fit: "contain",
          color: "#000000",
          width: 720,
          height: 1280,
        },
      ],
    },
  ],
});
const preparation = {
  createId: () => 100,
  advancedEditingEnabled: false,
  compile: compilePvoComponent,
};

test("Choice starts panel free and assistant style patches retain unrelated visual rules", async () => {
  const added = await api.prepareNativeBatch(
    project(),
    [
      {
        kind: "component.add",
        sceneId: "main",
        componentType: "choice",
        at: 0,
        duration: 5,
      },
    ],
    preparation,
  );
  const id = added.project.scenes[0].components[0].id;
  const before = api.nativeProjectContext(added.project, 0).scenes[0]
    .components[0];
  assert.equal(before.design, undefined);
  assert.match(before.source.style, /choice \{[^}]*background: transparent/s);
  assert.match(before.source.style, /#option0 \{[^}]*background: #FF9FBC/s);

  const first = await api.prepareNativeBatch(
    added.project,
    [
      {
        kind: "component.style",
        sceneId: "main",
        componentId: id,
        style:
          "choice { gap: 18px; } prompt { text-transform: uppercase; letter-spacing: 2px; }",
      },
    ],
    preparation,
  );
  const second = await api.prepareNativeBatch(
    first.project,
    [
      {
        kind: "component.style",
        sceneId: "main",
        componentId: id,
        style: "#option1 { background: #00E5A0; box-shadow: none; }",
      },
    ],
    preparation,
  );
  const component = second.project.scenes[0].components[0];
  const style = component.code.pvo.style;
  assert.match(style, /choice \{[^}]*background: transparent/s);
  assert.match(style, /#option0 \{[^}]*background: #FF9FBC/s);
  assert.match(style, /#option1 \{[^}]*background: #00E5A0/s);
  assert.match(style, /gap: 18px/);
  assert.match(style, /text-transform: uppercase/);
  assert.equal((style.match(/gap:/g) ?? []).length, 1);
  assert.equal(
    component.code.pvo.logic,
    first.project.scenes[0].components[0].code.pvo.logic,
  );
  const compiled = await compilePvoComponent("choice", component.code.pvo);
  assert.match(compiled.css, /gap:18px/);
  assert.match(compiled.css, /box-shadow:none/);
});
