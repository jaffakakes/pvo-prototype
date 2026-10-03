import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { sourceModules } from "../helpers/source-assets.mjs";
import { validateFontAsset, fontFamily } from "../../../packages/pvo-fonts/index.js";
import { packageManifestFonts } from "../../../packages/pvo-fonts/portable.js";
import { packPvoProject, PVO_SPEC_VERSION } from "../../../packages/pvo-sdk/index.js";

const font = validateFontAsset({
  id: "web-fixture", family: "Portable Test Font", sourceUrl: "https://example.com/font", licenseUrl: "https://example.com/license",
  licenseText: "Existing repository font used solely as an internal rendering fixture.",
  faces: [{ dataUrl: `data:font/woff2;base64,${(await readFile(new URL("../../../editor/src/fonts/peace-sans.woff2", import.meta.url))).toString("base64")}`, weight: "400 700", style: "normal" }],
});
const family = fontFamily(font);
const served = new Map();
for (const directory of ["player", "packages/pvo-fonts", "packages/pvo-animation", "packages/pvo-sdk", "packages/pvo-code-runtime", "packages/pvo-component-runtime", "packages/pvo-text-runtime", "packages/pvo-language"]) {
  for (const [path, asset] of await sourceModules(new URL(`../../../${directory}/`, import.meta.url), `/${directory}`)) served.set(path, asset);
}
for (const [route, path, type] of [
  ["/player/", "player/index.html", "text/html"],
  ["/player/styles.css", "player/styles.css", "text/css"],
  ["/packages/pvo-language/pkg/pvo_language.js", "packages/pvo-language/pkg/pvo_language.js", "text/javascript"],
  ["/packages/pvo-language/pkg/pvo_language_bg.wasm", "packages/pvo-language/pkg/pvo_language_bg.wasm", "application/wasm"],
  ...["peace-sans", "open-sauce-600", "open-sauce-700"].map(name => [`/player/fonts/${name}.woff2`, `editor/src/fonts/${name}.woff2`, "font/woff2"]),
]) served.set(route, { body: await readFile(new URL(`../../../${path}`, import.meta.url)), type });
const texts = [{ id: 1, text: "Portable font", start: 0, end: 2, x: 50, y: 70, style: { fontAsset: font } }];
const manifest = {
  spec_version: PVO_SPEC_VERSION, initial_scene: "main", canvas: { ratio: "9:16" },
  media: [{ id: "media", asset_id: "video" }], scenes: [{ id: "main", asset_id: "video", start: 0, end: 2 }],
  playback: { initial_timeline: "main", timelines: [{ id: "main", kind: "main", clips: [{ id: "clip", scene: "main", asset_id: "video", start: 0, end: 2 }] }] },
  restyle_capture: { version: 1, scene_layers: { main: { order: ["video", "component:native", "component:code", "text:1"], texts } } },
  components: ["native", "code"].map((id, index) => ({ id, kind: "tooltip", text: `${id} Portable font`,
    presentation: { scene: "main", start: 0, end: 2, x: .1, y: .2 + index * .2, width: .8, height: .1 },
    restyle_capture: { version: 1, at: 0, dur: 2, x: 50, y: 20 + index * 20, font,
      ...(id === "code" ? { code: { language: { version: 1, structure: "structure", style: "style", logic: "logic" } } } : {}),
    },
  })),
};
const packaged = packageManifestFonts(manifest);
const media = await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url));
const pvo = Buffer.from(await (await packPvoProject({ manifest: packaged.manifest, assets: [
  ...packaged.assets, { id: "video", blob: new Blob([media], { type: "video/mp4" }) },
  { id: "structure", blob: new Blob(['<tooltip><text>code Portable font</text></tooltip>']) },
  { id: "style", blob: new Blob(['tooltip { color: #ffffff; }']) }, { id: "logic", blob: new Blob([" "]) },
] })).arrayBuffer());
let origin;
const server = createServer((request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end('<main id="host"></main>'); return; }
  const asset = served.get(new URL(request.url, origin).pathname);
  if (!asset) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": asset.type }); response.end(asset.body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
const failures = [];
const external = [];
page.on("pageerror", error => failures.push(error.message));
page.on("request", request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) external.push(request.url()); });
try {
  await page.goto(origin);
  const widths = await page.evaluate(async (font) => {
    const { createFontScope, fontFamily } = await import("/packages/pvo-fonts/index.js");
    const { drawText } = await import("/packages/pvo-text-runtime/index.js");
    const scope = createFontScope();
    await scope.load(font);
    const family = fontFamily(font);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = '700 30px Arial';
    const fallback = ctx.measureText("Portable font").width;
    ctx.font = `700 30px "${family}"`;
    const custom = ctx.measureText("Portable font").width;
    drawText(ctx, 247, 500, { text: "Portable font", x: 50, y: 50, style: { fontAsset: font } });
    window.scope = scope;
    const { mountCustomComponent } = await import("/packages/pvo-code-runtime/index.js");
    window.errors = [];
    window.handle = mountCustomComponent(document.getElementById("host"), {
      componentId: "font-test", html: '<div>Portable font <button>Button</button><input value="Input"></div>', css: "button{font-family:serif}", js: " ", font,
      onError: error => window.errors.push(error),
    });
    return { fallback, custom, loaded: document.fonts.check(`700 30px "${family}"`) };
  }, font);
  assert.equal(widths.loaded, true);
  assert.ok(Math.abs(widths.custom - widths.fallback) > 2, "canvas must use the downloaded glyph metrics");
  await page.waitForFunction(family => {
    const doc = document.querySelector('iframe[sandbox="allow-same-origin"]')?.contentDocument;
    return doc?.fonts.check(`700 30px "${family}"`) && [...doc.fonts].length > 0;
  }, family);
  const sandbox = await page.evaluate(family => {
    const doc = document.querySelector('iframe[sandbox="allow-same-origin"]').contentDocument;
    return { family: doc.defaultView.getComputedStyle(doc.querySelector("button")).fontFamily,
      csp: doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
      errors: window.errors, count: [...doc.fonts].length };
  }, family);
  assert.equal(sandbox.family.replaceAll('"', ''), family);
  assert.match(sandbox.csp, /font-src 'none'/);
  assert.equal(sandbox.count, 1);
  assert.deepEqual(sandbox.errors, []);
  assert.equal(await page.evaluate(() => { window.handle.destroy(); window.scope.dispose(); return [...document.fonts].length; }), 0);

  await page.goto(`${origin}/player/`);
  await page.locator("#pvoInput").setInputFiles({ name: "portable-font.pvo", mimeType: "application/vnd.pvo", buffer: pvo });
  await page.waitForFunction(family => {
    const view = document.querySelector("pvo-component-view");
    const frame = document.querySelector('iframe[sandbox="allow-same-origin"]');
    return view?.shadowRoot?.querySelector(".tip") && frame?.contentDocument?.querySelector("#pvo-root")?.textContent.includes("Portable font") && [...frame.contentDocument.fonts].some(face => face.family === family);
  }, family);
  const player = await page.evaluate(family => {
    const view = document.querySelector("pvo-component-view");
    const doc = document.querySelector('iframe[sandbox="allow-same-origin"]').contentDocument;
    return { native: getComputedStyle(view.shadowRoot.querySelector(".tip")).fontFamily,
      code: doc.defaultView.getComputedStyle(doc.querySelector("#pvo-root")).fontFamily,
      loaded: document.fonts.check(`700 18px "${family}"`), texts: document.querySelectorAll("canvas.capture-text").length };
  }, family);
  assert.equal(player.native.replaceAll('"', ''), family);
  assert.equal(player.code.replaceAll('"', ''), family);
  assert.equal(player.loaded, true);
  assert.equal(player.texts, 1);
  assert.deepEqual(external, [], "exported font rendering must make no web requests");
  assert.deepEqual(failures, []);
  console.log("Font rendering passed: real WOFF2 canvas metrics, host-only sandbox font loading, cleanup, deduplicated portable export, native/code/text player and zero remote downloads.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
