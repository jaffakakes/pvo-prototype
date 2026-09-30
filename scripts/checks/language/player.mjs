import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { sourceModules } from "../helpers/source-assets.mjs";
import { packPvoProject, readPvoProject, PVO_SPEC_VERSION } from "../../../packages/pvo-sdk/index.js";

// Prerequisites: `npm run build:language` and Chrome (or CHROME_PATH).
// Serve the player source directly so this check does not replace or depend on dist/.
const routes = [
  ["/player/", "../../../player/index.html", "text/html; charset=utf-8"],
  ["/player/app.js", "../../../player/app.js", "text/javascript"],
  ["/player/styles.css", "../../../player/styles.css", "text/css"],
  ["/player/fonts/peace-sans.woff2", "../../../editor/src/fonts/peace-sans.woff2", "font/woff2"],
  ["/player/fonts/open-sauce-600.woff2", "../../../editor/src/fonts/open-sauce-600.woff2", "font/woff2"],
  ["/player/fonts/open-sauce-700.woff2", "../../../editor/src/fonts/open-sauce-700.woff2", "font/woff2"],
  ["/packages/pvo-sdk/index.js", "../../../packages/pvo-sdk/index.js", "text/javascript"],
  ["/packages/pvo-code-runtime/index.js", "../../../packages/pvo-code-runtime/index.js", "text/javascript"],
  ["/packages/pvo-text-runtime/index.js", "../../../packages/pvo-text-runtime/index.js", "text/javascript"],
  ["/packages/pvo-component-runtime/index.js", "../../../packages/pvo-component-runtime/index.js", "text/javascript"],
  ["/packages/pvo-language/index.js", "../../../packages/pvo-language/index.js", "text/javascript"],
  ["/packages/pvo-language/result.js", "../../../packages/pvo-language/result.js", "text/javascript"],
  ["/packages/pvo-language/pkg/pvo_language.js", "../../../packages/pvo-language/pkg/pvo_language.js", "text/javascript"],
  ["/packages/pvo-language/pkg/pvo_language_bg.wasm", "../../../packages/pvo-language/pkg/pvo_language_bg.wasm", "application/wasm"],
];

let servedAssets;
try {
  servedAssets = new Map(await Promise.all(routes.map(async ([route, path, type]) => [
    route,
    { body: await readFile(new URL(path, import.meta.url)), type },
  ])));
  for (const directory of ["player", "packages/pvo-sdk", "packages/pvo-code-runtime", "packages/pvo-component-runtime", "packages/pvo-text-runtime"]) {
    const modules = await sourceModules(new URL(`../../../${directory}/`, import.meta.url), `/${directory}`);
    modules.forEach(([route, asset]) => servedAssets.set(route, asset));
  }
} catch (error) {
  throw new Error(`PVO language player check needs generated WASM. Run npm run build:language first. ${error.message}`);
}

const video = await readFile(new URL("../../../assets/pvo-demo.mp4", import.meta.url));
const componentId = "choice-main";
const base = `components/${componentId}`;
const source = {
  structure: '<choice><prompt>Language source</prompt><option id="first">Language route</option><option id="second">Continue</option></choice>',
  style: "option { color: #FFFFFF; }",
  logic: "on choose(first) { go_to_scene(\"branch\"); } on choose(second) { continue(); }",
};
const invalidSource = {
  ...source,
  structure: source.structure.replace('id="first"', 'id="first" onclick="pvo.pick(0)"'),
};
const legacyCode = {
  html: '<div><h3>Legacy code</h3><button onclick="pvo.pick(0)">Legacy route</button><button onclick="pvo.pick(1)">Continue</button></div>',
  css: "div { color: white; background: #15151c; padding: 12px; } button { padding: 12px; }",
  js: " ",
};
const staleCode = {
  html: '<div><button onclick="pvo.pick(1)">Stale compiled route</button></div>',
  css: "div { color: red; }",
  js: " ",
};

function manifestFor(language) {
  return {
    spec_version: PVO_SPEC_VERSION,
    initial_scene: "main",
    canvas: { ratio: "9:16", width: 9, height: 16 },
    restyle_capture: { version: 1 },
    media: [
      { id: "media-main", asset_id: "asset-main", name: "media/main.mp4", type: "video/mp4" },
      { id: "media-branch", asset_id: "asset-branch", name: "media/branch.mp4", type: "video/mp4" },
    ],
    scenes: [
      { id: "main", label: "Main", asset_id: "asset-main", start: 0, end: 1.5 },
      { id: "branch", label: "Branch", asset_id: "asset-branch", start: 0, end: 0.7 },
    ],
    playback: {
      initial_timeline: "timeline-main",
      timelines: [
        { id: "timeline-main", kind: "main", clips: [{ id: "clip-main", scene: "main", asset_id: "asset-main", start: 0, end: 1.5 }] },
        { id: "timeline-branch", kind: "branch", clips: [{ id: "clip-branch", scene: "branch", asset_id: "asset-branch", start: 0, end: 0.7 }] },
      ],
    },
    components: [{
      id: componentId,
      kind: "choice",
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      title: language ? "Language source" : "Legacy code",
      presentation: { scene: "main", start: 0.2, end: 0.25, x: 0.15, y: 0.42, width: 0.71, height: 0.4 },
      options: [
        { label: "Open branch", action: language ? { type: "custom", name: "restyle_continue" } : { type: "goto_scene", scene: "branch" } },
        { label: "Continue", action: { type: "custom", name: "restyle_continue" } },
      ],
      restyle_capture: {
        version: 1, at: 0.2, dur: null, x: 50, y: 62,
        outcomes: [language ? { kind: "continue" } : { kind: "scene", sceneId: "branch" }, { kind: "continue" }],
        code: {
          html: `${base}/index.html`,
          css: `${base}/style.css`,
          js: `${base}/script.js`,
          fields: {},
          ...(language ? { language: {
            version: 1,
            structure: `${base}/structure.pvo`,
            style: `${base}/style.pvo`,
            logic: `${base}/logic.pvo`,
          } } : {}),
        },
      },
    }],
  };
}

async function packageFor(name, languageSource = null) {
  const assets = [
    { id: "asset-main", name: "media/main.mp4", blob: new Blob([video], { type: "video/mp4" }) },
    { id: "asset-branch", name: "media/branch.mp4", blob: new Blob([video], { type: "video/mp4" }) },
  ];
  const code = languageSource ? staleCode : legacyCode;
  for (const [part, file, type] of [
    ["html", "index.html", "text/html"],
    ["css", "style.css", "text/css"],
    ["js", "script.js", "text/javascript"],
  ]) {
    const path = `${base}/${file}`;
    assets.push({ id: path, name: path, blob: new Blob([code[part]], { type }) });
  }
  if (languageSource) {
    for (const part of ["structure", "style", "logic"]) {
      const path = `${base}/${part}.pvo`;
      assets.push({ id: path, name: path, blob: new Blob([languageSource[part]], { type: "text/plain" }) });
    }
  }
  const blob = await packPvoProject({ manifest: manifestFor(Boolean(languageSource)), assets });
  const decoded = await readPvoProject(blob);
  assert.equal(decoded.validation.valid, true, `${name}: ${decoded.validation.errors.join("; ")}`);
  return { name: `${name}.pvo`, mimeType: "application/vnd.pvo", buffer: Buffer.from(await blob.arrayBuffer()) };
}

const packages = {
  invalid: await packageFor("invalid-language", invalidSource),
  language: await packageFor("language-source", source),
  legacy: await packageFor("legacy-code"),
};

const server = createServer((request, response) => {
  const route = new URL(request.url ?? "/", "http://localhost").pathname;
  if (route === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  const asset = servedAssets.get(route);
  if (!asset) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": asset.type,
    "content-length": asset.body.length,
    "cache-control": "no-store",
  });
  response.end(asset.body);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const playerUrl = `http://127.0.0.1:${server.address().port}/player/`;
let browser;
let page;
const browserErrors = [];

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  page = await context.newPage();
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  const response = await page.goto(playerUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);

  // A valid cached HTML fallback must not bypass an invalid PVO source file.
  await page.locator("#pvoInput").setInputFiles(packages.invalid);
  await page.locator("#status.error.is-visible").waitFor({ state: "attached", timeout: 10000 });
  assert.match(await page.locator("#status").textContent(), /structure line .*attribute/i);
  assert.equal(await page.locator("#playerShell").isVisible(), false);

  await page.locator("#pvoInput").setInputFiles(packages.language);
  await page.locator("#playerShell").waitFor({ state: "visible" });
  await page.getByText("Choose to continue").waitFor({ state: "visible", timeout: 10000 });
  const languageFrame = page.locator(".code-position iframe").first().contentFrame();
  await languageFrame.getByRole("button", { name: "Language route" }).waitFor({ state: "visible" });
  assert.equal(await languageFrame.getByRole("button", { name: "Stale compiled route" }).count(), 0);
  assert.equal(await languageFrame.getByText("Language source").count(), 1);
  await page.waitForTimeout(400); // The iframe can paint before its action Worker is ready.
  await languageFrame.getByRole("button", { name: "Language route" }).click();
  await page.locator('#video[data-asset-id="asset-branch"]').waitFor({ timeout: 10000 });
  await page.locator("#endScreen").waitFor({ state: "visible", timeout: 10000 });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#pvoInput").setInputFiles(packages.legacy);
  await page.locator("#status.error.is-visible").waitFor({ state: "attached", timeout: 10000 });
  assert.match(await page.locator("#status").textContent(), /retired HTML\/CSS\/JavaScript format/i);
  assert.equal(await page.locator("#playerShell").isVisible(), false);
  assert.deepEqual(browserErrors, []);
  console.log("PVO language player passed: invalid source rejected, source recompiled over stale assets, Choice routed, legacy code rejected.");
} catch (error) {
  console.error(`PVO language player failed: ${error.message}`);
  console.error(`Player status: ${await page?.locator("#status").textContent().catch(() => "unavailable")}`);
  console.error(`Video: ${JSON.stringify(await page?.locator("#video").evaluate(video => ({ paused: video.paused, time: video.currentTime, duration: video.duration, readyState: video.readyState, asset: video.dataset.assetId })).catch(() => ({})))}`);
  console.error(`Overlay frames: ${await page?.locator(".code-position iframe").count().catch(() => "unavailable")}`);
  console.error(`Browser errors: ${browserErrors.join("; ") || "none"}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
