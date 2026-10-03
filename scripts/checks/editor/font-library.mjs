import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { fontFamily } from "../../../packages/pvo-fonts/index.js";

const bytes = await readFile(new URL("../../../editor/src/fonts/peace-sans.woff2", import.meta.url));
const asset = {
  id: "web-peace-fixture", family: "Peace Fixture", sourceUrl: "https://foundry.example/peace.woff2",
  licenseUrl: "https://foundry.example/license", licenseText: "Fixture font licence.",
  faces: [{ dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, weight: "400", style: "normal" }],
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(10000);
const webQueries = [];
const imports = [];
let googleSearches = 0;
let releaseSlowImport;
let releaseSlowSearch;
await context.route("**/api/web/search?**", async route => {
  const query = new URL(route.request().url()).searchParams.get("q");
  webQueries.push(query);
  if (query === "slow search") await new Promise(resolve => { releaseSlowSearch = resolve; });
  await route.fulfill({ json: { results: [
    { title: "Independent foundry", url: "https://foundry.example/fonts", snippet: "Fonts from an independent designer. <b>Plain text only</b>" },
    { title: "Peace font file", url: "https://foundry.example/peace.woff2", snippet: "Direct font file from the foundry." },
  ] } }).catch(() => {});
});
await context.route("**/api/fonts/search?**", async route => {
  googleSearches++;
  await route.fulfill({ json: { fonts: [{ id: "google-peace", family: "Peace", category: "sans-serif" }] } });
});
await context.route("**/api/fonts/download?**", route => route.fulfill({ json: { ...asset, id: "google-peace" } }));
await context.route("**/api/fonts/import", async route => {
  assert.equal(route.request().method(), "POST");
  const input = route.request().postDataJSON();
  imports.push(input);
  if (input.family === "Slow Font") await new Promise(resolve => { releaseSlowImport = resolve; });
  await route.fulfill({ json: asset }).catch(() => {});
});
const picker = page.locator("[data-font-picker]");
const browse = () => picker.getByRole("button", { name: /Browse fonts/ }).click();
const state = () => page.evaluate(() => ({
  component: window.fontLibraryCapture.getState().components[0],
  history: window.fontLibraryCapture.getState().past.length,
}));
async function projectFixture(projectId) {
  await page.evaluate(async projectId => {
    const { navigateProject } = await import("/src/app/navigation.ts");
    window.fontLibraryCapture = (await import("/src/store.ts")).useCapture;
    const clip = { id: 1, url: null, color: "#4d4257", srcDur: 20, in: 0, out: 20, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "cover" };
    const scene = { id: "main", name: "Main", parent: null, clips: [clip], texts: [], components: [], muted: true, sound: -1, layers: ["video"] };
    const capture = window.fontLibraryCapture.getState();
    capture.patch({ localId: projectId, scenes: [scene], currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"], screen: "editor", sheet: null, selComp: null, t: 4, past: [], future: [] });
    window.fontLibraryCapture.getState().addComponent("tooltip");
    navigateProject(projectId, true);
    await document.fonts.ready;
  }, projectId);
  await page.getByRole("tab", { name: "Look", exact: true }).click();
  await browse();
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await projectFixture("font-project-one");
  await picker.getByRole("textbox", { name: "Search web fonts", exact: true }).fill("independent foundry serif font");
  await picker.getByRole("button", { name: "Search web", exact: true }).click();
  await picker.getByRole("link", { name: "Independent foundry", exact: true }).waitFor();
  assert.deepEqual(webQueries, ["independent foundry serif font"]);
  assert.equal(googleSearches, 0, "General web search must not silently use only the Google catalogue");
  assert.equal(await picker.locator("b").count(), 0, "Web snippets remain escaped text");
  assert.equal(await picker.getByRole("link", { name: "Independent foundry", exact: true }).getAttribute("target"), "_blank");
  await picker.getByRole("button", { name: "Use font file URL", exact: true }).click();
  assert.equal(await picker.getByRole("textbox", { name: "Font file URL", exact: true }).inputValue(), asset.sourceUrl);
  await picker.getByRole("textbox", { name: "Font family name", exact: true }).fill(asset.family);
  await picker.getByRole("textbox", { name: "Licence URL", exact: true }).fill(asset.licenseUrl);
  const original = await state();
  await picker.getByRole("button", { name: "Preview font", exact: true }).click();
  await picker.locator("[data-font-preview]").waitFor();
  assert.deepEqual(imports[0], { family: asset.family, url: asset.sourceUrl, licenseUrl: asset.licenseUrl });
  const family = fontFamily(asset);
  assert.equal(await page.evaluate(family => document.fonts.check(`24px "${family}"`), family), true,
    "Preview decodes and registers the actual WOFF2 fixture with browser FontFace");
  assert.equal(await picker.locator("[data-font-preview] p").evaluate(element => getComputedStyle(element).fontFamily), family);
  assert.deepEqual(await state(), original, "Preview never applies or adds history");
  await picker.getByRole("button", { name: "Save & apply font", exact: true }).click();
  await picker.getByRole("button", { name: `${asset.family} · Browse fonts`, exact: true }).waitFor();
  const applied = await state();
  assert.equal(applied.component.font.id, asset.id);
  assert.equal(applied.history, original.history + 1, "Apply is a single undoable component change");

  await page.reload({ waitUntil: "networkidle" });
  await projectFixture("font-project-two");
  await picker.getByRole("button", { name: asset.family, exact: true }).click();
  await picker.locator("[data-font-preview]").waitFor();
  assert.equal(imports.length, 1, "Saved fonts survive reload and are reused in another project without downloading");
  await picker.getByRole("button", { name: "Save & apply font", exact: true }).click();
  await picker.getByRole("button", { name: `${asset.family} · Browse fonts`, exact: true }).waitFor();
  assert.equal((await state()).component.font.id, asset.id);

  await browse();
  await picker.getByText("Import font URL", { exact: true }).click();
  await picker.getByRole("textbox", { name: "Font family name", exact: true }).fill("Slow Font");
  await picker.getByRole("textbox", { name: "Font file URL", exact: true }).fill(asset.sourceUrl);
  await picker.getByRole("textbox", { name: "Licence URL", exact: true }).fill(asset.licenseUrl);
  await picker.getByRole("button", { name: "Preview font", exact: true }).click();
  await picker.getByText("Downloading font preview…", { exact: true }).waitFor();
  await picker.getByRole("button", { name: "Close fonts", exact: true }).click();
  assert(releaseSlowImport, "Delayed import reached the API boundary");
  releaseSlowImport();
  await browse();
  assert.equal(await picker.locator("[data-font-preview]").count(), 0, "Closing prevents a late download from restoring a preview");

  await picker.getByRole("textbox", { name: "Search web fonts", exact: true }).fill("slow search");
  await picker.getByRole("button", { name: "Search web", exact: true }).click();
  await picker.getByText("Searching the web…", { exact: true }).waitFor();
  await picker.getByRole("button", { name: "Google Fonts catalogue", exact: true }).click();
  assert(releaseSlowSearch, "Delayed search reached the API boundary");
  releaseSlowSearch();
  await picker.getByRole("textbox", { name: "Search web fonts", exact: true }).fill("Peace");
  await picker.getByRole("button", { name: "Search Google Fonts", exact: true }).click();
  await picker.getByRole("button", { name: "Peace sans-serif · Preview font", exact: true }).waitFor();
  assert.equal(await picker.getByRole("list", { name: "Web font sources", exact: true }).count(), 0,
    "Switching providers discards a late web response");
  assert.equal(googleSearches, 1, "Google Fonts remains an explicit catalogue shortcut");
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true,
      `Font controls do not overflow the ${width}px editor inspector`);
  }
  assert.deepEqual(errors, []);
  console.log("Font library UI passed: general web sources, direct URL import, real font preview, single-step apply, cross-project persistence, cancellation and explicit Google catalogue.");
} catch (error) {
  console.error(error.stack);
  console.error((await page.locator("body").innerText()).slice(-3500));
  console.error(errors);
  process.exitCode = 1;
} finally {
  releaseSlowImport?.();
  releaseSlowSearch?.();
  await context.close();
  await browser.close();
}
