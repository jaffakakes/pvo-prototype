import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { componentSourceResult, finishAssistantVerification, selectedAssistantComponent } from "./assistant-fixture.mjs";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

// Vite supplies the real store and WASM compiler. Only the AI HTTP response is a fixture.
const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const cases = [
  { type: "tooltip", label: "Text", tag: "text", part: "Text",
    structure: "<tooltip><text>AI tooltip</text></tooltip>", logic: "" },
  { type: "card", label: "Title", tag: "title", part: "Title",
    structure: '<card><title>AI card</title><body>Keep this body</body><button id="primary">Explore</button></card>',
    logic: "on press(primary) { continue(); }", target: "primary", event: "press" },
  { type: "choice", label: "Prompt", tag: "prompt", part: "Heading",
    structure: '<choice><prompt>AI choice</prompt><option id="left">Street</option><option id="right">Evening</option></choice>',
    logic: 'on choose(left) { continue(); }\non choose(right) { continue(); }', target: "left", event: "choose" },
  { type: "form", label: "Heading", tag: "heading", part: "Heading",
    structure: '<form><heading>AI form</heading><field name="contact_phone" kind="phone" label="Mobile"/><field name="contact_email" kind="email" label="Email"/><submit waiting="Sending…">Send</submit></form>',
    logic: "on submit { continue(); }" },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const errors = [];
const completed = [];
let activePage;

async function seed(page, type) {
  // The landing sample keeps a media range request open after the app is ready.
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#create-title, .camWrap").first().waitFor();
  await page.evaluate(async type => {
    window.capture = (await import("/src/store.ts")).useCapture;
    const { advanceUidPast } = await import("/src/infrastructure/ids.ts");
    advanceUidPast({ tooltip: 10, card: 20, choice: 30, form: 40 }[type]);
    const clip = { id: 1, url: null, color: "#4d4257", srcDur: 2, in: 0, out: 2,
      speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "cover" };
    const scene = { id: "main", name: "Main", parent: null, clips: [clip], texts: [],
      components: [], muted: true, sound: -1, layers: ["video"] };
    window.capture.getState().patch({ scenes: [scene], currentSceneId: "main", clips: [clip],
      texts: [], components: [], layers: ["video"], screen: "editor", sheet: null,
      selComp: null, t: 0, past: [], future: [] });
    const id = window.capture.getState().addComponent(type);
    window.capture.getState().updateComponent(id, { x: 43, y: 57, scale: 0.9, at: 0, dur: 2 });
    window.capture.getState().patch({ sheet: null });
  }, type);
}

const component = page => page.evaluate(() => {
  const state = window.capture.getState();
  return JSON.parse(JSON.stringify(state.components.find(item => item.id === state.selComp)));
});
const tab = (page, name) => page.getByRole("tab", { name, exact: true }).click();
const field = (page, name) => page.getByLabel(name, { exact: true });

async function settled(page) {
  await page.waitForFunction(() => {
    const state = window.capture.getState();
    const current = state.components.find(item => item.id === state.selComp);
    return current?.code?.pvoTouched === false && !!current.code.pvoCompiled
      && JSON.stringify(current.code.pvoLastValid) === JSON.stringify(current.code.pvo);
  });
}

async function compile(page) {
  return page.evaluate(async root => {
    const { compilePvoComponent } = await import(`/@fs/${root}packages/pvo-language/index.js`);
    const state = window.capture.getState();
    const current = state.components.find(item => item.id === state.selComp);
    return compilePvoComponent(current.type, current.code.pvo);
  }, root);
}

async function saved(page, expected) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async expected => {
      const checkpoint = await new Promise((resolve, reject) => {
        const request = indexedDB.open("restyle-editor-project");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction("checkpoints", "readonly").objectStore("checkpoints").get("current");
          read.onsuccess = () => { db.close(); resolve(read.result); };
          read.onerror = () => { db.close(); reject(read.error); };
        };
      });
      const restored = checkpoint?.project.scenes.flatMap(scene => scene.components).find(item => item.id === expected.id);
      return JSON.stringify(restored) === JSON.stringify(expected);
    }, expected);
    if (ready) return;
    await page.waitForTimeout(100);
  }
  assert.fail("The browser checkpoint must contain the complete final synchronized component before reload");
}

async function formFields(page) {
  await tab(page, "Content");
  await field(page, "Field 1 name").fill("Contact number");
  await field(page, "Submit button").fill("Join list");
  await page.getByRole("button", { name: /Add a field/ }).click();
  await field(page, "Field 3 name").fill("Age");
  await page.getByLabel("Field 3 answer type").getByRole("button", { name: "A number", exact: true }).click();
  await page.getByRole("button", { name: /Add a field/ }).click();
  await field(page, "Field 4 name").fill("Updates");
  await page.getByLabel("Field 4 answer type").getByRole("button", { name: "Yes / no", exact: true }).click();
  await page.getByRole("button", { name: "Remove field 2", exact: true }).click();
  await tab(page, "Look");
  await settled(page);
  const compiled = await compile(page);
  assert.deepEqual(compiled.structure.fields.map(({ label, kind }) => ({ label, kind })), [
    { label: "Contact number", kind: "phone" }, { label: "Age", kind: "number" }, { label: "Updates", kind: "yesno" },
  ], "Phone, typed additions and removal must reach the real compiler without converting unrelated fields");
  assert.equal(compiled.structure.fields[0].name, "contact_phone", "Renaming a visible label preserves the authored field identity");
  assert.equal(compiled.structure.submit, "Join list");
}

async function exercise(item) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  let requests = 0;
  let verifications = 0;
  let source = { structure: item.structure, logic: item.logic,
    style: `${item.type} { background: #123456; color: #ffffff; border-radius: 11px; }\n${item.tag} { font-size: 23px; }${item.target ? `\n#${item.target} { color: #abcdef; }` : ""}` };
  await context.route("**/api/assistant/turn", async route => {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    assert.equal(selectedAssistantComponent(request).component.type, item.type);
    if (await finishAssistantVerification(route, request)) {
      verifications++;
      return;
    }
    requests++;
    await route.fulfill({ json: componentSourceResult(request, source, "Updated the wording and appearance.") });
  });
  await seed(page, item.type);
  // Exact-source synchronization uses a readable provider fixture; pvo-formatting covers compact replies.
  source = await page.evaluate(async source => {
    const { formatPvoSource } = await import("/src/domain/components/languageFormatting.ts");
    return formatPvoSource(source);
  }, source);
  const before = await component(page);
  const historyBefore = await page.evaluate(() => window.capture.getState().past.length);
  await page.locator("[data-assistant-orb]").click();
  await field(page, "Describe a change").fill("Rewrite the wording and give it a dark blue background");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.locator('[data-assistant-phase="idle"]').waitFor();
  assert.equal(requests, 1);
  assert.equal(verifications, 1, "The provider verifies the compiled working copy before automatic apply");
  const kept = await component(page);
  assert.deepEqual(kept.code.pvo, source, "Automatic apply retains the exact validated provider source");
  assert.deepEqual(kept.code.pvoLastValid, source);
  assert.equal(kept.code.pvoTouched, false);
  assert.equal(await page.evaluate(() => window.capture.getState().past.length), historyBefore + 1);
  for (const key of ["id", "x", "y", "scale", "at", "dur"]) assert.equal(kept[key], before[key]);
  await page.evaluate(() => window.capture.getState().patch({ sheet: "component" }));
  await tab(page, "Content");
  assert.equal(await page.getByRole("tab", { name: "Advanced", exact: true }).count(), 0,
    "AI results must be visually editable while Advanced is hidden");
  assert.equal(await field(page, item.label).isEnabled(), true);
  assert.equal(await field(page, item.label).inputValue(), `AI ${item.type}`);
  await field(page, item.label).fill(`Visual ${item.type} & <edited>`);
  await tab(page, "Look");
  await page.getByRole("button", { name: "Whole", exact: true }).click();
  await page.locator("[data-look-part-controls]").getByRole("button", { name: "Custom", exact: true }).first().click();
  assert.equal((await field(page, "Background hex").inputValue()).toUpperCase(), "#123456");
  await field(page, "Background hex").fill("#654321");
  await page.getByRole("button", { name: item.part, exact: true }).click();
  await page.getByText("Custom · 23px", { exact: true }).waitFor();
  for (const size of ["S", "M", "L", "XL"])
    assert.equal(await page.getByRole("button", { name: size, exact: true }).getAttribute("aria-pressed"), "false");
  await settled(page);
  let current = await component(page);
  assert.match(current.code.pvo.structure, /Visual .* &amp; &lt;edited&gt;/);
  assert.match(current.code.pvo.style, /font-size: 23px/);
  if (item.target) assert.match(current.code.pvo.style, new RegExp(`#${item.target}\\s*\\{[^}]*#abcdef`, "i"));
  if (item.type === "form") await formFields(page);

  if (item.target) {
    await tab(page, "Action");
    await page.getByRole("button", { name: /When viewers tap/ }).first().click();
    await page.evaluate(() => window.capture.getState().patch({ t: 1 }));
    await page.getByRole("button", { name: /Jump to a point/ }).click();
    await settled(page);
    assert.match((await component(page)).code.pvo.logic, new RegExp(`on ${item.event}\\(${item.target}\\)\\s*\\{\\s*jump_to\\(1\\)`));
  }
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("switch", { name: "Advanced editing", exact: true }).click();
  await page.evaluate(() => window.capture.getState().patch({ sheet: "component" }));
  await tab(page, "Advanced");
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  current = await component(page);
  const advancedStructure = current.code.pvo.structure.replace(`Visual ${item.type} &amp; &lt;edited&gt;`, `Advanced ${item.type}`);
  await field(page, "Structure source").fill(advancedStructure);
  await tab(page, "Content");
  await settled(page);
  assert.equal(await field(page, item.label).inputValue(), `Advanced ${item.type}`,
    "Compilation must complete after leaving Advanced and refresh visual content");
  await tab(page, "Advanced");
  await tab(page, "Style");
  const advancedStyle = (await component(page)).code.pvo.style + `\n${item.type} { background: #456789; }`;
  await field(page, "Style source").fill(advancedStyle);
  await tab(page, "Look");
  await settled(page);
  await page.getByRole("button", { name: "Whole", exact: true }).click();
  await page.locator("[data-look-part-controls]").getByRole("button", { name: "Custom", exact: true }).first().click();
  assert.equal((await field(page, "Background hex").inputValue()).toUpperCase(), "#456789",
    "Direct Style edits must update visual colour controls");
  await field(page, "Background hex").fill("#654321");
  await settled(page);
  if (item.type !== "tooltip") {
    await tab(page, "Advanced");
    await tab(page, "Logic");
    const logic = item.type === "form" ? "on submit { jump_to(1); }"
      : (await component(page)).code.pvo.logic.replace("jump_to(1)", "continue()");
    await field(page, "Logic source").fill(logic);
    await tab(page, "Action");
    await settled(page);
    const actionRow = page.getByRole("button", { name: /When viewers tap/ }).first();
    assert.match(await actionRow.innerText(), item.type === "form" ? /Jump to a point/ : /Continue video/,
      "Direct Logic edits must update visual action controls");
    const fields = (await component(page)).fields;
    const action = item.type === "form" ? fields.outcome : (item.type === "card" ? fields.buttons : fields.options)[0].outcome;
    assert.deepEqual(action, item.type === "form" ? { kind: "time", t: 1 } : { kind: "continue" });
  }
  await tab(page, "Content");
  await field(page, item.label).fill(`Final ${item.type}`);
  await tab(page, "Look");
  await settled(page);
  const final = await component(page);
  assert.match(final.code.pvo.style, /font-size: 23px/);
  assert.match(final.code.pvo.style, /#654321/i);
  await page.evaluate(() => window.capture.getState().undo());
  await settled(page);
  await tab(page, "Content");
  assert.equal(await field(page, item.label).inputValue(), `Advanced ${item.type}`);
  await page.evaluate(() => window.capture.getState().redo());
  await settled(page);
  assert.deepEqual(await component(page), final, "Redo restores source, visual fields and appearance atomically");
  await saved(page, final);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(async () => { window.capture = (await import("/src/store.ts")).useCapture; });
  await page.waitForFunction(id => window.capture.getState().components.some(item => item.id === id), final.id);
  await page.evaluate(id => window.capture.getState().patch({ selComp: id, sheet: "component", screen: "editor" }), final.id);
  assert.deepEqual(await component(page), final, "Reload preserves the synchronized component");
  await tab(page, "Content");
  assert.equal(await field(page, item.label).isEnabled(), true);
  assert.equal(await field(page, item.label).inputValue(), `Final ${item.type}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await compile(page);
  completed.push(final);
  await context.close();
  activePage = undefined;
  console.log(`Component sync: ${item.type} AI apply, visual/source edits, undo/redo and reload passed.`);
}

async function verifyExport() {
  const page = await browser.newPage();
  activePage = page;
  await seed(page, "tooltip");
  const bytes = await page.evaluate(async components => {
    const { exportPvo } = await import("/src/features/export/exportPvo.ts");
    const state = window.capture.getState();
    const layers = ["video", ...components.map(item => `component:${item.id}`)];
    state.patch({ components, layers, scenes: [{ ...state.scenes[0], components, layers }] });
    const artifact = await exportPvo(window.capture.getState(), () => {});
    try { return Array.from(new Uint8Array(await (await fetch(artifact.url)).arrayBuffer())); }
    finally { URL.revokeObjectURL(artifact.url); }
  }, completed);
  const decoded = await readPvoProject(new Blob([Uint8Array.from(bytes)], { type: "application/vnd.pvo" }));
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.manifest.components.length, 4);
  const assets = new Map(decoded.assets.map(asset => [asset.id, asset.blob]));
  for (const [index, exported] of decoded.manifest.components.entries()) {
    const language = exported.restyle_capture.code.language;
    for (const part of ["structure", "style", "logic"]) {
      const source = completed[index].code.pvo[part];
      const exportedSource = await assets.get(language[part]).text();
      // The container uses a whitespace asset for display-only, empty Logic.
      assert.equal(source ? exportedSource : exportedSource.trim(), source,
        `Export preserves the final ${completed[index].type} ${part} source`);
    }
  }
  await page.close();
  activePage = undefined;
}

try {
  for (const item of cases) await exercise(item);
  await verifyExport();
  assert.deepEqual(errors, []);
  console.log("Component sync passed: all four types retain exact PVO through visual/Advanced editing, history, saved-project reload and real media export.");
} catch (error) {
  if (activePage && !activePage.isClosed()) console.error((await activePage.locator("body").innerText()).slice(0, 2500));
  throw error;
} finally {
  await browser.close();
}
