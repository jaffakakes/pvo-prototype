import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const font = {
  id: "cover-rendering", family: "Cover Rendering", sourceUrl: "https://example.com/font", licenseUrl: "https://example.com/license",
  licenseText: "Repository font used solely as an internal rendering fixture.",
  faces: [{ dataUrl: `data:font/woff2;base64,${(await readFile(new URL("../../../editor/src/fonts/peace-sans.woff2", import.meta.url))).toString("base64")}`,
    weight: "400 800", style: "normal" }],
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const failures = [];
page.on("pageerror", error => failures.push(error.message));
try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  const cover = await page.evaluate(async ({ font }) => {
    const { captureCoverFrame } = await import("/src/features/export/captureCoverFrame.ts");
    const track = (from, to) => [{ time: 0, value: from, easing: "linear" }, { time: 2, value: to, easing: "linear" }];
    const scene = { id: "main", name: "Main", parent: null, muted: true, sound: 0,
      clips: [{ id: 1, url: null, color: "#000", srcDur: 3, in: 0, out: 3, speed: 1,
        fit: "contain", mirror: false, zoom: 1, width: 1080, height: 1920,
        animation: { tracks: { x: track(0, 100) } } }],
      texts: [{ id: 1, text: "", color: 0, start: 0, end: 3, x: 50, y: 50,
        style: { size: 100, background: "#00ff00", opacity: 1, fontAsset: font } }],
      components: [{ id: "note", type: "tooltip", at: 0, dur: 3, x: 50, y: 80, fields: { text: "Applied font" }, font }],
      layers: ["text:1", "video", "component:note"] };
    const calls = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (String(args[0]).includes("Applied")) calls.push({ font: this.font, loaded: document.fonts.check(this.font) });
      return fillText.apply(this, args);
    };
    const pixels = [];
    try {
      for (const at of [0, 2]) {
        const image = await createImageBitmap(await captureCoverFrame(scene, "9:16", at));
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close();
        pixels.push([...context.getImageData(540, 960, 1, 1).data]);
      }
    } finally { CanvasRenderingContext2D.prototype.fillText = fillText; }
    return { pixels, calls, retainedFonts: [...document.fonts].filter(face => face.family.includes("pvo-cover-rendering-")).length };
  }, { font });
  assert(cover.pixels[0].slice(0, 3).every(value => value < 30), "Opaque footage must cover the lower text layer");
  assert(cover.pixels[1][1] > 220 && cover.pixels[1][0] < 30, "Animated footage must reveal the lower text layer in the WebP");
  assert(cover.calls.length >= 2 && cover.calls.every(call => call.font.includes("pvo-cover-rendering-") && call.loaded));
  assert.equal(cover.retainedFonts, 0, "Cover capture releases its applied fonts");

  await page.evaluate(async ({ root, font }) => {
    // Use the app's resolved dependency URLs so symlinked worktrees share its React instance.
    const entry = await (await fetch("/src/main.tsx")).text();
    const dependency = name => entry.match(new RegExp(`from "([^"]*/deps/${name}\\.js[^\\"]*)"`))?.[1];
    const React = (await import(dependency("react"))).default;
    const { createRoot } = (await import(dependency("react-dom_client"))).default;
    const { ExportPreview } = await import("/src/features/export/ExportPreview.tsx");
    const { packPvoProject, PVO_SPEC_VERSION } = await import(`/@fs/${root}/packages/pvo-sdk/index.js`);
    const track = (from, to, start = 1, end = 5) => [{ time: start, value: from, easing: "linear" }, { time: end, value: to, easing: "linear" }];
    const url = `/@fs/${root}/share/assets/preview.mp4`;
    const scene = { id: "main", name: "Main", parent: null, muted: true, sound: 0,
      clips: [{ id: 1, url, color: "#000", srcDur: 6, in: 1, out: 5, speed: 2,
        fit: "contain", mirror: false, zoom: 1, width: 1080, height: 1920,
        animation: { tracks: { x: track(0, 40), opacity: track(1, 0) } } }],
      texts: [{ id: 1, text: "Lower text", color: 0, start: 0, end: 2, x: 50, y: 50, style: { fontAsset: font } }],
      components: [{ id: "note", type: "tooltip", at: 0, dur: 2, x: 50, y: 80, fields: { text: "Applied font" }, font,
        animation: { tracks: { x: track(0, 20, 0, 2) } } }],
      layers: ["text:1", "video", "component:note"] };
    const manifest = { spec_version: PVO_SPEC_VERSION, initial_scene: "main",
      media: [{ id: "media", asset_id: "video" }], scenes: [{ id: "main", asset_id: "video", start: 0, end: 2 }], components: [],
      playback: { initial_timeline: "main", timelines: [{ id: "main", kind: "main", clips: [{ id: "clip", scene: "main", asset_id: "video", start: 0, end: 2 }] }] } };
    const blob = await packPvoProject({ manifest, assets: [{ id: "video", blob: await (await fetch(url)).blob() }] });
    const host = document.createElement("div"); host.id = "export-rendering-fixture";
    host.style.cssText = "position:fixed;inset:0;background:black;z-index:2147483647;width:550px;height:850px";
    document.body.append(host);
    const view = createRoot(host);
    window.renderExportFixture = mode => view.render(React.createElement(ExportPreview, {
      scene, ratio: "9:16", mode, pickerTime: 1, onPickerTime() {}, artifactUrl: null,
      artifact: mode === "done" ? { format: "pvo", blob, snapshotId: "fixture" } : null,
    }));
    window.renderExportFixture("picker");
  }, { root, font });
  const fixture = page.locator("#export-rendering-fixture");
  await fixture.locator('[data-layer-id="text:1"]').waitFor();
  await page.waitForFunction(() => document.querySelector('#export-rendering-fixture [data-layer-id="video"]').style.opacity === "0.5");
  const preview = await fixture.evaluate(host => {
    const video = host.querySelector('[data-layer-id="video"]');
    const text = host.querySelector('[data-layer-id="text:1"]');
    const component = host.querySelector('[data-layer-id="component:note"]');
    return { transform: video.style.transform, lowerText: +text.style.zIndex < +video.style.zIndex,
      componentLeft: component.style.left, playbackRate: host.querySelector("video").playbackRate };
  });
  assert(preview.transform.includes("translate(20%, 0%)"));
  assert.equal(preview.lowerText, true);
  assert.equal(preview.componentLeft, "60%");
  assert.equal(preview.playbackRate, 2);
  await page.evaluate(() => window.renderExportFixture("done"));
  await fixture.locator('video[data-visible="true"]').waitFor();
  const slider = fixture.getByRole("slider", { name: "Scrub export preview" });
  await slider.fill("1");
  await page.waitForFunction(() => document.querySelector('#export-rendering-fixture video[data-visible="true"]').style.opacity === "0.5");
  const result = await fixture.evaluate(host => {
    const video = host.querySelector('video[data-visible="true"]');
    const text = host.querySelector('[data-layer-id="text:1"]');
    const component = host.querySelector('[data-layer-id="component:note"]');
    return { transform: video.style.transform, hasText: !!text,
      ordered: +text.style.zIndex < +video.style.zIndex && +video.style.zIndex < +component.style.zIndex };
  });
  assert.equal(result.hasText, true);
  assert.equal(result.ordered, true);
  assert(result.transform.includes("translate(20%, 0%)"));
  assert.deepEqual(failures, []);
  console.log("Export rendering passed: WebP lower-layer reveal and applied fonts; source/result PVO layer order, animation clocks and source speed.");
} finally { await browser.close(); }
