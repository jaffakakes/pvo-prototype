import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `
      export * from "./editor/src/domain/components/timing.ts";
      export * from "./editor/src/domain/export/manifest.ts";
      export * from "./editor/src/domain/layers/order.ts";
      export * from "./editor/src/domain/scenes/duration.ts";
      export * from "./editor/src/features/export/pvoMediaSource.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const {
  buildPvoManifest,
  componentEnd,
  layerOrder,
  pvoSceneMediaSource,
  sceneDuration,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const clip = {
  id: 1,
  url: null,
  color: "#000",
  srcDur: 8,
  in: 0,
  out: 8,
  speed: 1,
  zoom: 1,
  mirror: false,
  width: 1080,
  height: 1920,
  fit: "contain",
};
const audio = {
  id: 2,
  name: "Tail",
  url: "blob:audio",
  srcDur: 3,
  in: 0,
  out: 3,
  speed: 1,
  start: 7,
  muted: false,
};
const textOverlay = {
  id: 3,
  text: "Tail text",
  color: 0,
  start: 9,
  end: 11,
  x: 50,
  y: 50,
};
const explicitComponent = {
  id: "explicit",
  type: "tooltip",
  sceneId: "main",
  at: 10,
  dur: 2,
  x: 50,
  y: 50,
  fields: { text: "Explicit tail" },
};
const clipBoundComponent = {
  ...explicitComponent,
  id: "clip-bound",
  at: 6,
  dur: null,
  fields: { text: "Until clip ends" },
};
const scene = {
  id: "main",
  name: "Main",
  parent: null,
  clips: [clip],
  audioClips: [audio],
  texts: [textOverlay],
  components: [explicitComponent, clipBoundComponent],
  muted: false,
  sound: 0,
  layers: [
    "video",
    "text:3",
    "component:explicit",
    "component:clip-bound",
  ],
};

test("scene duration includes media and explicit overlays but keeps null components clip-bound", () => {
  assert.equal(componentEnd(explicitComponent, [clip]), 12);
  assert.equal(componentEnd(clipBoundComponent, [clip]), 8);
  assert.equal(sceneDuration(scene), 12);
  assert.equal(
    sceneDuration({ ...scene, components: [clipBoundComponent] }),
    11,
    "Text remains longer than audio and video",
  );
  assert.equal(
    sceneDuration({
      ...scene,
      audioClips: [],
      texts: [],
      components: [clipBoundComponent],
    }),
    8,
  );
});

test("manifest scene, timeline and component presentations share the extended duration", () => {
  const project = {
    currentSceneId: "main",
    ratio: "9:16",
    allowedDomains: [],
    scenes: [scene],
  };
  const manifest = buildPvoManifest(project, [
    {
      scene,
      assetId: "main-media",
      name: "main.webm",
      type: "video/webm",
    },
  ]);
  assert.equal(manifest.scenes[0].end, 12);
  assert.equal(manifest.playback.timelines[0].clips[0].end, 12);
  assert.deepEqual(
    manifest.components.map((component) => [
      component.id,
      component.presentation.start,
      component.presentation.end,
    ]),
    [
      ["explicit", 10, 12],
      ["clip-bound", 6, 8],
    ],
  );
});

test("PVO media rendering preserves overlay duration without burning native layers", () => {
  const source = pvoSceneMediaSource(
    { ratio: "9:16", quality: "720p" },
    scene,
  );
  assert.equal(sceneDuration(source), 12);
  assert.strictEqual(source.texts, scene.texts);
  assert.strictEqual(source.components, scene.components);
  const order = layerOrder(source);
  assert.equal(order.at(-1), "video");
  assert.ok(order.indexOf("text:3") < order.indexOf("video"));
  assert.ok(order.indexOf("component:explicit") < order.indexOf("video"));
});
