import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/export/captureCoverFrame.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { captureCoverFrame } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function canvasHarness({ failBlob = false, blobMode = "webp" } = {}) {
  const events = [];
  const canvases = [];
  const createCanvas = () => {
    const id = canvases.length;
    const stack = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      font: "",
      lineWidth: 1,
      globalAlpha: 1,
      fillRect() {},
      save() {
        stack.push({
          font: this.font,
          globalAlpha: this.globalAlpha,
          fillStyle: this.fillStyle,
        });
      },
      restore() {
        Object.assign(this, stack.pop());
      },
      translate(...args) {
        events.push(["translate", ...args, id]);
      },
      scale(...args) {
        events.push(["scale", ...args, id]);
      },
      rotate(value) {
        events.push(["rotate", value, id]);
      },
      beginPath() {},
      roundRect() {},
      drawImage(canvas) {
        events.push(["image", canvas.id, this.globalAlpha, id]);
      },
      fill() {
        events.push(["fill", this.fillStyle, id]);
      },
      stroke() {},
      measureText(value) {
        return {
          width: String(value).length * 6,
          fontBoundingBoxAscent: 8,
          fontBoundingBoxDescent: 2,
        };
      },
      fillText(value) {
        events.push(["text", value, this.font, id]);
      },
      strokeText() {},
      createLinearGradient() {
        return { addColorStop() {} };
      },
    };
    const canvas = {
      id,
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (callback, requestedType) => {
        events.push(["encode", requestedType, id]);
        if (failBlob) return callback(null);
        const type =
          blobMode === "png" ||
          (blobMode === "large-png" && requestedType === "image/webp")
            ? "image/png"
            : requestedType;
        const bytes =
          blobMode === "large-png" && id === 0 ? 5 * 1024 * 1024 + 1 : 16;
        callback(new Blob([new Uint8Array(bytes)], { type }));
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  return { createCanvas, canvases, events };
}

function component(id, type, at = 0, dur = 4) {
  const fields = {
    tooltip: { text: "A note" },
    card: {
      title: "A card",
      body: "Body copy",
      buttons: [{ label: "Explore" }],
    },
    choice: {
      prompt: "Pick one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    form: {
      heading: "Join us",
      formFields: [{ name: "Email", type: "text" }],
      submitLabel: "Send it",
    },
  };
  return { id, type, at, dur, x: 50, y: 50, fields: fields[type] };
}

function scene(components, layers) {
  return {
    id: "main",
    name: "Main",
    parent: null,
    clips: [
      {
        id: 1,
        url: null,
        color: "#000000",
        srcDur: 4,
        in: 0,
        out: 4,
        speed: 1,
        zoom: 1,
        mirror: false,
        width: 1080,
        height: 1920,
        fit: "contain",
      },
    ],
    texts: [
      { id: 1, text: "Overlay text", color: 0, start: 0, end: 4, x: 50, y: 50 },
    ],
    components,
    layers,
    muted: true,
    sound: 0,
  };
}

async function capture(input, at, options = {}) {
  const { createCanvas, canvases, events } = canvasHarness(options);
  const previous = globalThis.document;
  class FontFace {
    constructor(family) {
      this.family = family;
    }
    async load() {
      events.push(["font-loaded", this.family]);
      return this;
    }
  }
  globalThis.document = {
    defaultView: { FontFace },
    fonts: {
      ready: Promise.resolve(),
      add: (face) => events.push(["font-added", face.family]),
      delete: (face) => events.push(["font-deleted", face.family]),
    },
    createElement: (name) => {
      assert.equal(name, "canvas");
      return createCanvas();
    },
  };
  try {
    if (options.failBlob)
      await assert.rejects(
        captureCoverFrame(input, "9:16", at),
        /could not create the cover image/,
      );
    else {
      const blob = await captureCoverFrame(input, "9:16", at);
      assert.equal(
        blob.type,
        options.blobMode === "png" || options.blobMode === "large-png"
          ? "image/png"
          : "image/webp",
      );
      assert.deepEqual([canvases[0].width, canvases[0].height], [1080, 1920]);
    }
    return events;
  } finally {
    globalThis.document = previous;
  }
}

test("cover capture accepts PNG returned for a WebP request on iPhone browsers", async () => {
  const events = await capture(scene([], ["video"]), 0, { blobMode: "png" });
  assert.deepEqual(
    events.filter(([kind]) => kind === "encode"),
    [["encode", "image/webp", 0]],
  );
});

test("oversized PNG cover is scaled before export", async () => {
  const events = await capture(scene([], ["video"]), 0, {
    blobMode: "large-png",
  });
  const encodes = events.filter(([kind]) => kind === "encode");
  assert.deepEqual(
    encodes.map(([, type]) => type),
    ["image/webp", "image/png"],
  );
  assert.notEqual(encodes[0][2], encodes[1][2]);
});

test("cover frame includes all four visual component types in authored layer order", async () => {
  const components = [
    component("tip", "tooltip"),
    component("card", "card"),
    component("choice", "choice"),
    component("form", "form"),
  ];
  const input = scene(components, [
    "video",
    "component:tip",
    "text:1",
    "component:card",
    "component:choice",
    "component:form",
  ]);
  const captions = (await capture(input, 1))
    .filter((event) => event[0] === "text")
    .map((event) => event[1]);
  assert(captions.indexOf("A note") < captions.indexOf("Overlay text"));
  assert(captions.indexOf("Overlay text") < captions.indexOf("A card"));
  for (const label of [
    "Body copy",
    "Explore",
    "Pick one",
    "Alpha",
    "Beta",
    "Join us",
    "Email",
    "Send it",
  ])
    assert(captions.includes(label), `Missing ${label} from cover image`);
});

test("cover frame respects component timing and video occlusion, and omits code-owned iframe pixels", async () => {
  const hidden = component("under", "card");
  hidden.fields.title = "Under video";
  const future = component("future", "card", 2, 1);
  future.fields.title = "Not yet";
  const code = component("code", "tooltip");
  code.code = { custom: true, pvo: { structure: "" } };
  const input = scene(
    [hidden, future, code, component("visible", "tooltip")],
    [
      "component:under",
      "video",
      "component:future",
      "component:code",
      "component:visible",
      "text:1",
    ],
  );
  const events = await capture(input, 1);
  const captions = events
    .filter((event) => event[0] === "text")
    .map((event) => event[1]);
  assert(captions.includes("A note"));
  const underVideo = events.findIndex(
    (event) => event[0] === "text" && event[1] === "Under video",
  );
  const composites = events.flatMap((event, index) =>
    event[0] === "image" && event[3] === 0 ? [index] : [],
  );
  assert(
    underVideo < composites[0] && composites[0] < composites[1],
    "Lower components composite before the video layer",
  );
  assert(!captions.includes("Not yet"));
  assert.equal(captions.filter((value) => value === "A note").length, 1);
});

test("cover painter applies an authored look and explicit pixel dimensions", async () => {
  const styled = component("styled", "card");
  styled.width = 320;
  styled.height = 180;
  styled.look = {
    preset: "custom",
    basePreset: "bold",
    whole: {
      bg: "#123456",
      border: "#654321",
      text: "#FFFFFF",
      radius: 14,
      align: "center",
    },
    heading: { color: "#FFFFFF", size: "L", align: "center" },
    body: { color: "#FFFFFF", size: "M", weight: 600, align: "center" },
    btns: [
      {
        fill: "#ABCDEF",
        text: "#000000",
        border: "#000000",
        size: "M",
        weight: 800,
        radius: 14,
      },
    ],
  };
  const events = await capture(
    scene([styled], ["video", "component:styled", "text:1"]),
    1,
  );
  assert(events.some((event) => event[0] === "fill" && event[1] === "#123456"));
  assert(events.some((event) => event[0] === "fill" && event[1] === "#ABCDEF"));
  assert(
    events.some(
      (event) => event[0] === "scale" && event[1] > 0 && event[2] > 0,
    ),
  );
});

function track(from, to, start, end) {
  return [
    { time: start, value: from, easing: "linear" },
    { time: end, value: to, easing: "linear" },
  ];
}

test("cover evaluates trimmed video, text and component animation on their own clocks", async () => {
  const overlay = component("moving", "tooltip", 1, 4);
  overlay.animation = {
    tracks: {
      x: track(0, 20, 0, 2),
      opacity: track(1, 0.5, 0, 2),
      rotation: track(0, 90, 0, 2),
    },
  };
  const input = scene([overlay], ["text:1", "component:moving", "video"]);
  input.clips[0] = {
    ...input.clips[0],
    in: 2,
    out: 10,
    srcDur: 10,
    speed: 2,
    animation: {
      tracks: { x: track(0, 100, 2, 10), opacity: track(1, 0, 2, 10) },
    },
  };
  input.texts[0] = {
    ...input.texts[0],
    start: 1,
    animation: { tracks: { y: track(0, 20, 0, 2) } },
  };
  const events = await capture(input, 2);
  const positions = events.filter(
    (event) => event[0] === "translate" && event[3] === 0,
  );
  assert.deepEqual(positions, [
    ["translate", 540, 1152, 0],
    ["translate", 648, 960, 0],
    ["translate", 1080, 960, 0],
  ]);
  const composites = events.filter(
    (event) => event[0] === "image" && event[3] === 0,
  );
  assert.deepEqual(
    composites.map((event) => event[2]),
    [0.75, 0.5],
    "Component/video opacity applies once to each complete layer",
  );
  assert(
    events.some(
      (event) =>
        event[0] === "rotate" && event[1] === Math.PI / 4 && event[2] === 0,
    ),
  );
});

const font = {
  id: "cover-fixture",
  family: "Cover Fixture",
  sourceUrl: "https://example.com/font",
  licenseUrl: "https://example.com/license",
  licenseText: "Repository font used as an internal test fixture.",
  faces: [
    {
      dataUrl: `data:font/woff2;base64,${readFileSync("editor/src/fonts/peace-sans.woff2").toString("base64")}`,
      weight: "400 800",
      style: "normal",
    },
  ],
};

test("cover loads applied fonts before painting and releases its scope on success or failure", async () => {
  const overlay = { ...component("custom-font", "card"), font };
  const input = scene([overlay], ["video", "component:custom-font", "text:1"]);
  input.texts[0].style = { fontAsset: font };
  for (const failBlob of [false, true]) {
    const events = await capture(input, 1, { failBlob });
    assert.equal(
      events.filter((event) => event[0] === "font-added").length,
      1,
      "Shared font bytes load once per cover",
    );
    const installed = events.findIndex((event) => event[0] === "font-added");
    const painted = events.findIndex((event) => event[0] === "text");
    const released = events.findIndex((event) => event[0] === "font-deleted");
    assert(installed < painted && painted < released);
    for (const event of events.filter((event) => event[0] === "text"))
      assert(
        event[2].includes("pvo-cover-fixture-"),
        `${event[1]} must use the applied font`,
      );
  }
});
