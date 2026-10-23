import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "../helpers/browser.mjs";
import { playerSourceAssets } from "../helpers/player-assets.mjs";
import {
  packPvoProject,
  PVO_SPEC_VERSION,
} from "../../../packages/pvo-sdk/index.js";

const assets = await playerSourceAssets();
const portrait = await readFile(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
const landscape = await readFile(
  new URL("../../../assets/pvo-demo.mp4", import.meta.url),
);
assets.set("/portrait.mp4", { type: "video/mp4", body: portrait });
assets.set("/landscape.mp4", { type: "video/mp4", body: landscape });
const fixture = await createBrowserFixture(assets);
const page = await fixture.context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);

async function packaged(video, choices = 0) {
  const manifest = {
    spec_version: PVO_SPEC_VERSION,
    initial_scene: "main",
    canvas: { ratio: choices ? "16:9" : video === portrait ? "9:16" : "16:9" },
    restyle_capture: { version: 1 },
    media: [{ id: "main-media", asset_id: "video", type: "video/mp4" }],
    scenes: [{ id: "main", asset_id: "video", start: 0, end: 2 }],
    playback: {
      initial_timeline: "main",
      timelines: [
        {
          id: "main",
          kind: "main",
          clips: [
            { id: "clip", scene: "main", asset_id: "video", start: 0, end: 2 },
          ],
        },
      ],
    },
    components: [],
  };
  const files = [
    {
      id: "video",
      name: "media/main.mp4",
      blob: new Blob([video], { type: "video/mp4" }),
    },
  ];
  if (choices) {
    manifest.media.push({
      id: "branch-media",
      asset_id: "branch-video",
      type: "video/mp4",
    });
    manifest.scenes.push({
      id: "branch",
      asset_id: "branch-video",
      start: 0,
      end: 1,
    });
    manifest.playback.timelines.push({
      id: "branch",
      kind: "branch",
      clips: [
        {
          id: "branch-clip",
          scene: "branch",
          asset_id: "branch-video",
          start: 0,
          end: 1,
        },
      ],
    });
    files.push({
      id: "branch-video",
      name: "media/branch.mp4",
      blob: new Blob([video], { type: "video/mp4" }),
    });
    const options = Array.from({ length: choices }, (_, index) => ({
      id: `option${index}`,
      label: `Option ${index + 1}`,
    }));
    const source = {
      structure: `<choice><prompt>Pick a route</prompt>${options.map((option) => `<option id="${option.id}">${option.label}</option>`).join("")}</choice>`,
      style: "option { color: #111111; }",
      logic: options
        .map((option) => `on choose(${option.id}) { go_to_scene("branch"); }`)
        .join("\n"),
    };
    const language = { version: 1 };
    for (const [part, text] of Object.entries(source)) {
      language[part] = `choice/${part}.pvo`;
      files.push({
        id: language[part],
        name: `components/choice/${part}.pvo`,
        blob: new Blob([text], { type: "text/plain" }),
      });
    }
    manifest.components.push({
      id: "choice",
      kind: "choice",
      title: "Pick a route",
      presentation: {
        scene: "main",
        start: 0,
        end: 0.25,
        x: 0.1,
        y: 0.2,
        width: 0.8,
        height: 0.6,
      },
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      options: options.map((option) => ({
        label: option.label,
        action: { type: "goto_scene", scene: "branch" },
      })),
      restyle_capture: { code: { language } },
    });
  }
  return Buffer.from(
    await (await packPvoProject({ manifest, assets: files })).arrayBuffer(),
  );
}

async function open(buffer, previous) {
  await page.locator("#pvoInput").setInputFiles({
    name: "fixture.pvo",
    mimeType: "application/vnd.pvo",
    buffer,
  });
  await page.waitForFunction((old) => {
    const video = document.querySelector("#video");
    return video?.src && video.src !== old && video.readyState >= 2;
  }, previous);
}
async function frame() {
  return page.locator("#video").evaluate((video) => {
    video.pause();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, 32, 32);
    const hash = context
      .getImageData(0, 0, 32, 32)
      .data.reduce(
        (value, byte) => Math.imul(value ^ byte, 16777619) >>> 0,
        2166136261,
      );
    return {
      src: video.src,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      hash,
    };
  });
}
try {
  await page.goto(fixture.origin + "/player/");
  const expected = await page.evaluate(async () => {
    const results = [];
    for (const source of ["/portrait.mp4", "/landscape.mp4"]) {
      const video = document.createElement("video");
      try {
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = reject;
          video.src = source;
        });
        results.push(video.duration);
      } finally {
        video.removeAttribute("src");
        video.load();
      }
    }
    return results;
  });
  await open(await packaged(portrait), "");
  const first = await frame();
  await open(await packaged(landscape), first.src);
  const second = await frame();
  assert(first.width < first.height);
  assert(second.width > second.height);
  assert.notEqual(
    first.hash,
    second.hash,
    "The player decodes the replacement footage",
  );
  assert(Math.abs(first.duration - expected[0]) < 0.01);
  assert(Math.abs(second.duration - expected[1]) < 0.01);
  console.log(
    "PASS: same asset ID switches URL, decoded frame, dimensions and duration without page navigation",
  );
  for (const count of [2, 3, 4]) {
    const previous = await page.locator("#video").getAttribute("src");
    await open(await packaged(landscape, count), previous);
    const rendered = page
      .locator('.code-position iframe[sandbox="allow-same-origin"]')
      .first()
      .contentFrame();
    const last = rendered.getByRole("button", {
      name: `Option ${count}`,
      exact: true,
    });
    await last.waitFor();
    assert.equal(await rendered.getByRole("button").count(), count);
    await page.waitForTimeout(400);
    await last.click();
    await page.locator('#video[data-asset-id="branch-video"]').waitFor();
    console.log(
      `PASS: packaged compiled ${count}-option Choice displays and executes its route`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await fixture.close();
}
