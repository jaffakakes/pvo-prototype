import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { fontFamily } from "../../../packages/pvo-fonts/index.js";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const bytes = await readFile(new URL("../../../editor/src/fonts/peace-sans.woff2", import.meta.url));
const font = { id: "web-independent-fixture", family: "Independent Fixture", sourceUrl: "https://foundry.example/fonts/independent.woff2",
  licenseUrl: "https://foundry.example/fonts/OFL.txt", licenseText: "Fixture licence retained in browser storage.",
  faces: [{ dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, weight: "400 700", style: "normal" }] };
const designPage = "https://design.example/posters/swiss";
const fontPage = "https://foundry.example/fonts/independent";
const designPrompt = "Search the web for Swiss poster design references and explain one example.";
const fontPrompt = "Find Independent Fixture at the independent foundry, save it, and apply it to my note and title.";
const designQuery = "Swiss poster design references";
const fontQuery = "Independent Fixture independent foundry font";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
await installAssistantAvailabilityFixture(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const fixtureErrors = [];
const queries = [];
const reads = [];
const imports = [];
const requests = [];
const rounds = new Map();
let googleRequests = 0;
page.on("pageerror", error => errors.push(error.message));
const result = (message, observations = [], operations = [], answer) => parseNativeTurnResult({ message, observations, operations, ...(answer ? { answer } : {}) });
const snapshot = () => page.evaluate(() => {
  const state = window.webCapture.getState();
  return JSON.parse(JSON.stringify({ scenes: state.scenes, ratio: state.ratio, past: state.past.length, future: state.future.length }));
});
let baseline;

await context.route("**/api/web/search?**", async route => {
  const query = new URL(route.request().url()).searchParams.get("q");
  queries.push(query);
  await route.fulfill({ json: { query, source: "Web search", retrievedAt: "2026-10-03T12:00:00Z", results: [
    query === designQuery ? { title: "Swiss poster collection", url: designPage, snippet: "Independent design reference with grid and typography examples." }
      : { title: "Independent font foundry", url: fontPage, snippet: "Download this designer's font and read its licence." },
  ] } });
});
await context.route("**/api/web/read?**", async route => {
  const url = new URL(route.request().url()).searchParams.get("url");
  reads.push(url);
  await route.fulfill({ json: { url, title: url === designPage ? "Swiss poster collection" : "Independent Fixture", retrievedAt: "2026-10-03T12:00:00Z", truncated: false,
    text: url === designPage ? "These posters use asymmetric grids and bold typography. <script>window.webContentExecuted=true</script>"
      : "Independent Fixture is available as a direct font file. The original copyright and licence travel with it.",
    links: url === designPage ? [] : [{ title: "Font download", url: font.sourceUrl }, { title: "Licence", url: font.licenseUrl }],
  } });
});
await context.route("**/api/fonts/import", async route => {
  imports.push(route.request().postDataJSON());
  await route.fulfill({ json: font });
});
await context.route("**/api/fonts/search?**", async route => { googleRequests++; await route.fulfill({ json: { fonts: [] } }); });
await context.route("**/api/fonts/download?**", async route => { googleRequests++; await route.fulfill({ status: 404, json: {} }); });

await context.route("**/api/assistant/turn", async route => {
  try {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    requests.push(request);
    const round = (rounds.get(request.prompt) ?? 0) + 1;
    rounds.set(request.prompt, round);
    assert.doesNotMatch(JSON.stringify(request), /data:font|Fixture licence retained|fontAsset|"faces"/,
      "Font bytes and licence documents must stay out of provider context");
    assert.deepEqual(await snapshot(), baseline, "Every tool and prepared candidate keeps the live project unchanged until completion");
    let response;
    if (request.prompt === designPrompt) {
      if (round === 1) response = result("Searching design references.", [{ kind: "web_search", query: designQuery }]);
      else if (round === 2) {
        assert.equal(request.observations[0].kind, "web_search");
        assert.equal(request.observations[0].results[0].url, designPage);
        response = result("Reading the design reference.", [{ kind: "web_read", url: designPage }]);
      } else {
        assert.equal(round, 3);
        assert.equal(request.observations[0].kind, "web_read");
        assert.match(request.observations[0].text, /asymmetric grids/);
        response = result("Found a design reference.", [], [], `The collection uses asymmetric grids and bold typography. [Swiss poster collection](${designPage})`);
      }
    } else {
      assert.equal(request.prompt, fontPrompt);
      if (round === 1) response = result("Finding the requested foundry font.", [{ kind: "web_search", query: fontQuery }]);
      else if (round === 2) {
        assert.equal(request.observations[0].kind, "web_search");
        response = result("Reading the foundry's download and licence.", [{ kind: "web_read", url: fontPage }]);
      } else if (round === 3) {
        assert.equal(request.observations[0].kind, "web_read");
        assert.equal(request.observations[0].links[0].url, font.sourceUrl);
        response = result("Saving the font for this browser.", [{ kind: "font_import", family: font.family, url: font.sourceUrl, licenseUrl: font.licenseUrl }]);
      } else if (round === 4) {
        assert.deepEqual(request.observations[0].font, { id: font.id, family: font.family });
        response = result("Checking the saved font library.", [{ kind: "saved_fonts" }]);
      } else if (round === 5) {
        assert.equal(request.observations[0].kind, "saved_fonts");
        assert.deepEqual(request.observations[0].fonts, [{ id: font.id, family: font.family, sourceUrl: font.sourceUrl }]);
        response = result("Applying the saved font.", [], [
          { kind: "font.apply", sceneId: "main", target: { kind: "component", id: "note" }, fontId: font.id },
          { kind: "font.apply", sceneId: "main", target: { kind: "text", id: 20 }, fontId: font.id },
        ]);
      } else {
        assert.equal(round, 6, "A search/read/import/library/apply/verify request completes within the existing six-round workflow");
        assert.deepEqual(request.execution.receipts.map(receipt => receipt.operation), ["font.apply", "font.apply"]);
        assert.deepEqual(request.project.scenes[0].components[0].font, { id: font.id, family: font.family });
        assert.deepEqual(request.project.scenes[0].texts[0].font, { id: font.id, family: font.family });
        response = result("Saved Independent Fixture and applied it to the note and title.");
      }
    }
    await route.fulfill({ json: response });
  } catch (error) {
    fixtureErrors.push(error.message);
    await route.fulfill({ status: 500, json: { error: { message: "Fixture assertion failed." } } });
  }
});
const field = page.getByRole("textbox", { name: "Describe a change", exact: true });
async function submit(prompt) {
  await page.locator("[data-assistant-orb]").click();
  await field.fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { resetAssistant } = await import("/src/state/assistant/assistantStore.ts");
    useCapture.setState(initial());
    resetAssistant();
    window.webCapture = useCapture;
    useCapture.getState().patch({ screen: "editor", clips: [mkClip(8, null, 0)], sound: -1, muted: true,
      t: 1, playing: false, sel: -1, selComp: "note", past: [], future: [],
      components: [{ id: "note", type: "tooltip", sceneId: "main", at: 0, dur: 6, x: 50, y: 30, fields: { text: "A note" } }],
      texts: [{ id: 20, text: "A title", color: 0, start: 0, end: 6, x: 50, y: 60 }],
    });
  });
  await page.locator('[data-assistant-phase="idle"]').waitFor();
  baseline = await snapshot();
  await submit(designPrompt);
  const answer = page.locator("[data-assistant-review]");
  await answer.waitFor();
  const citation = answer.getByRole("link", { name: "Swiss poster collection", exact: true });
  assert.equal(await citation.getAttribute("href"), designPage);
  assert.equal(await citation.getAttribute("target"), "_blank");
  assert.equal(await citation.getAttribute("rel"), "noreferrer noopener");
  assert.deepEqual(await snapshot(), baseline, "Web research is an answer without a project/history edit");
  assert.equal(await page.evaluate(() => window.webContentExecuted), undefined, "Retrieved page markup remains inert data");
  await answer.getByRole("button", { name: "Done", exact: true }).click();
  await submit(fontPrompt);
  await page.locator('[data-notification-id="assistantApplied"]').waitFor();
  const applied = await snapshot();
  assert.equal(applied.past, baseline.past + 1);
  assert.equal(applied.scenes[0].components[0].font.id, font.id);
  assert.equal(applied.scenes[0].texts[0].style.fontAsset.id, font.id);
  const family = fontFamily(font);
  await page.waitForFunction(family => document.fonts.check(`700 24px "${family}"`) && [...document.fonts].some(face => face.family === family), family);
  assert.equal(await page.locator('[data-preview-component="note"] [data-look-part="body"]').evaluate(element => getComputedStyle(element).fontFamily), family);
  const saved = await page.evaluate(async () => (await import("/src/infrastructure/fonts/library.ts")).readSavedFonts());
  assert.equal(saved.length, 1);
  assert.equal(saved[0].faces[0].dataUrl, font.faces[0].dataUrl);
  assert.equal(saved[0].licenseText, font.licenseText);
  await page.evaluate(() => window.webCapture.getState().undo());
  const undone = await snapshot();
  assert.deepEqual(undone.scenes, baseline.scenes);
  assert.equal(undone.past, baseline.past);
  await page.evaluate(() => window.webCapture.getState().redo());
  assert.equal((await snapshot()).scenes[0].components[0].font.id, font.id);
  assert.deepEqual(queries, [designQuery, fontQuery]);
  assert.deepEqual(reads, [designPage, fontPage]);
  assert.deepEqual(imports, [{ family: font.family, url: font.sourceUrl, licenseUrl: font.licenseUrl }]);
  assert.equal(googleRequests, 0, "A named independent font must not silently fall back to Google Fonts");
  assert.equal(rounds.get(designPrompt), 3);
  assert.equal(rounds.get(fontPrompt), 6);
  assert.equal(requests.length, 9);
  assert.deepEqual(fixtureErrors, []);
  assert.deepEqual(errors, []);
  console.log("Assistant web workflow passed: design search/read citation without edits, six-round independent font import/save/apply/verification, private font bytes, real rendering and one-step Undo/Redo.");
} catch (error) {
  console.error(error.stack);
  console.error({ fixtureErrors, errors, rounds: [...rounds], queries, reads, imports });
  console.error((await page.locator("body").innerText()).slice(-2500));
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
