import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { componentSourceResult, finishAssistantVerification } from "./assistant-fixture.mjs";

// Vite serves the real editor state and WASM compiler. Only AI HTTP responses are fixtures.
const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const url = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const request = {
  url: "https://example.com/answers?campaign=one&ref=two",
  method: "POST",
  body: JSON.stringify({ message: 'Say "hello"; {stay}, path\\end',
    url: "https://example.com/a?x=1&y=2", phone: "{state.form.format-form.customer}" }),
  onSuccess: { kind: "time", t: 3 }, onError: { kind: "continue" },
};
const card = {
  structure: '<card><title>Say &quot;yes&quot; &amp; go</title><body>Keep  two spaces, {braces}; café 😀</body><button id="accept">Let&#39;s go &gt; now</button></card>',
  style: "card{background:rgba(10,20,30,.5);color:#fff;}title{font-size:23px;font-weight:700;}#accept{background:#60A5FA;border-radius:9px;}",
  logic: "on press(accept){jump_to(3);}",
};
const form = {
  structure: '<form><heading>Say &quot;ready&quot; &amp; go</heading><field name="customer" kind="phone" label="Your &quot;number&quot;"/><submit waiting="Sending &quot;now&quot;">Send &amp; continue</submit></form>',
  style: "form{background:#15151C;color:#fff;}field{background:rgba(1,2,3,.5);border-radius:6px;}submit{font-size:16px;}",
  logic: `on submit{request(${JSON.stringify(request)});}`,
};
const aiSource = {
  ...card,
  structure: card.structure.replace("Say &quot;yes&quot;", "AI says &quot;yes&quot;"),
  style: "card{background:#60A5FA;color:#fff;}title{font-size:23px;font-weight:700;}#accept{background:#15151C;border-radius:9px;}",
};

const component = page => page.evaluate(() => JSON.parse(JSON.stringify(window.capture.getState().components[0])));
const historyLength = page => page.evaluate(() => window.capture.getState().past.length);
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });
const sourceArea = (page, part) => page.getByRole("textbox", { name: `${part} source`, exact: true });
const assertAutomaticOnly = async page => assert.equal(await button(page, "Format code").count(), 0,
  "Formatting is automatic and never adds a Format code button");

function assertReadable(source, message) {
  for (const [part, value] of Object.entries(source)) {
    assert.match(value, /\n {2}\S/, `${message}: ${part} has an indented body`);
    assert(value.split("\n").length >= 3, `${message}: ${part} is spread across readable lines`);
  }
}

async function compile(page, type, source) {
  return page.evaluate(async ({ root, type, source }) => {
    const { compilePvoComponent } = await import(`/@fs/${root}packages/pvo-language/index.js`);
    return compilePvoComponent(type, source);
  }, { root, type, source });
}

async function valid(page) {
  await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvoTouched === false);
  await page.getByRole("status").filter({ hasText: "Valid · preview updated" }).waitFor();
}

async function settled(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}

async function waitReadable(page) {
  await page.waitForFunction(() => {
    const source = window.capture.getState().components[0]?.code?.pvo;
    return source && Object.values(source).every(value => /\n {2}\S/.test(value));
  });
  await valid(page);
}

async function seed(page, type, source) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async ({ root, type, source }) => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { fieldsFromCompiled } = await import("/src/domain/components/fields.ts");
    const { DEFAULT_RESPONSE_POLICY } = await import("/src/domain/components/responsePolicy.ts");
    const { setAdvancedEditingEnabled } = await import("/src/state/preferences/editorPreferences.ts");
    const { setComponentAuthoringTab } = await import("/src/state/components/componentAuthoringStore.ts");
    const { compilePvoComponent } = await import(`/@fs/${root}packages/pvo-language/index.js`);
    const { useAssistant } = await import("/src/state/assistant/assistantStore.ts");
    const compiled = await compilePvoComponent(type, source);
    const id = `format-${type}`;
    const component = { id, type, sceneId: "main", at: 0, dur: 20, x: 50, y: 55,
      responsePolicy: { ...DEFAULT_RESPONSE_POLICY },
      fields: fieldsFromCompiled(compiled), code: { custom: true, pvoLiteral: true, pvoTouched: false,
        pvo: source, pvoLastValid: { ...source }, pvoCompiled: { structure: compiled.structure, rules: compiled.rules } } };
    const clips = [mkClip(20, null, 0)];
    const scene = { id: "main", name: "Main", parent: null, clips, texts: [], components: [component],
      layers: ["video", `component:${id}`], muted: true, sound: -1 };
    window.capture = useCapture;
    window.assistant = useAssistant;
    setAdvancedEditingEnabled(true);
    setComponentAuthoringTab(id, "content");
    useCapture.getState().patch({ scenes: [scene], currentSceneId: "main", clips, texts: [], components: [component],
      layers: scene.layers, screen: "editor", sheet: "component", selComp: id, selText: null, sel: -1,
      t: 2, playing: false, tryMode: null, playheadPick: null, past: [], future: [] });
  }, { root, type, source });
  await tab(page, "Content").waitFor();
  // More than the compiler debounce: rendering Content must not mutate source formatting.
  await page.waitForTimeout(450);
  assert.deepEqual((await component(page)).code.pvo, source, "Opening no-code Content leaves saved source byte-for-byte unchanged");
  assert.equal(await historyLength(page), 0, "Opening no-code Content adds no formatting history");
  await assertAutomaticOnly(page);
}

async function openingRoundTrip(page, type, compact) {
  await seed(page, type, compact);
  const before = await component(page);
  const compiledBefore = await compile(page, type, compact);
  await tab(page, "Advanced").click();
  await waitReadable(page);
  const formatted = await component(page);
  assertReadable(formatted.code.pvo, `${type}: opening Advanced formats the saved component`);
  assert.deepEqual(formatted.fields, before.fields, `${type}: formatting does not rewrite visual content or actions`);
  assert.deepEqual(await compile(page, type, formatted.code.pvo), compiledBefore,
    `${type}: formatted source has identical compiled Structure, rules, HTML, CSS and runtime code`);
  assert.equal(await historyLength(page), 1, `${type}: opening formatting is one undoable operation`);
  for (const name of ["Structure", "Style", "Logic"]) {
    await tab(page, name).click();
    await assertAutomaticOnly(page);
    assert.equal(await sourceArea(page, name).inputValue(), formatted.code.pvo[name.toLowerCase()]);
  }
  await button(page, "Undo").click();
  await page.waitForFunction(compact => JSON.stringify(window.capture.getState().components[0]?.code?.pvo) === JSON.stringify(compact), compact);
  await page.waitForTimeout(500);
  assert.deepEqual((await component(page)).code.pvo, compact, `${type}: Undo restores compact source without an auto-format loop`);
  assert.equal(await historyLength(page), 0);
  return { compiledBefore, formatted };
}

async function blurFormatting(page) {
  await tab(page, "Structure").click();
  const before = await component(page);
  const beforeHistory = await historyLength(page);
  const manual = { ...card, structure: card.structure.replace("Say &quot;yes&quot;", "Manual &quot;yes&quot;") };
  await sourceArea(page, "Structure").fill(manual.structure);
  await valid(page);
  await page.waitForTimeout(450);
  assert.deepEqual((await component(page)).code.pvo, manual,
    "Typing and validation keep compact source intact while its input stays focused");
  assert.equal(await sourceArea(page, "Structure").evaluate(element => element === document.activeElement), true);
  await assertAutomaticOnly(page);
  const compiled = await compile(page, "card", manual);
  assert.equal(await historyLength(page), beforeHistory + 1, "The focused typing session creates one edit");
  await tab(page, "Style").click();
  await waitReadable(page);
  const formatted = await component(page);
  assert.equal(await historyLength(page), beforeHistory + 1, "Formatting on blur joins the existing typing history entry");
  assert.deepEqual(await compile(page, "card", formatted.code.pvo), compiled);
  assertReadable(formatted.code.pvo, "Leaving the input automatically formats valid source");
  await assertAutomaticOnly(page);
  await button(page, "Undo").click();
  await page.waitForTimeout(500);
  assert.deepEqual(await component(page), before, "One Undo restores the component before both typing and its automatic formatting");
  assert.equal(await historyLength(page), beforeHistory, "Undo does not immediately auto-format again");
  await button(page, "Redo").click();
  await waitReadable(page);
  assert.deepEqual((await component(page)).code.pvo, formatted.code.pvo);
}

async function compactAssistant(page, requests, verifications) {
  await tab(page, "Structure").click();
  const before = await component(page);
  const beforeHistory = await historyLength(page);
  await button(page, "Expand language editor").click();
  await page.locator('[data-placement="floating"] [data-assistant-orb]').click();
  await page.getByRole("textbox", { name: "Describe a change", exact: true }).fill("Make this blue and update the wording");
  await button(page, "Send request").click();
  await page.locator('[data-notification-id="assistantApplied"]').waitFor();
  assert.equal(requests.length, 1);
  assert.equal(verifications.length, 1, "Formatted source is verified before the complete workflow applies");
  assert.equal(requests[0].mode, "plan");
  await valid(page);
  await settled(page);
  const kept = await component(page);
  assertReadable(kept.code.pvo, "Immediate apply saves readable AI source");
  await assertAutomaticOnly(page);
  assert.equal(await historyLength(page), beforeHistory + 1, "AI content and formatting commit together in one history entry");
  assert.deepEqual(await compile(page, "card", kept.code.pvo), await compile(page, "card", aiSource));
  if (process.env.PVO_FORMATTING_SCREENSHOT) {
    await sourceArea(page, "Structure").evaluate(element => {
      element.scrollTo(0, 0);
      element.dispatchEvent(new Event("scroll"));
    });
    await page.screenshot({ path: process.env.PVO_FORMATTING_SCREENSHOT });
  }
  await page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Undo", exact: true }).click();
  await button(page, "Collapse language editor").click();
  await page.waitForTimeout(500);
  assert.deepEqual(await component(page), before, "One Undo restores the component from before the AI change");
  assert.equal(await historyLength(page), beforeHistory);
}

async function invalidStyle(page) {
  await seed(page, "form", form);
  const draft = 'form { color: "#fff"; background: \'quoted ; { text }\'; }';
  const previous = (await component(page)).code.pvoLastValid;
  // Model a saved unfinished draft before its first Advanced opening.
  await page.evaluate(draft => {
    const state = window.capture.getState(), current = state.components[0];
    state.updateComponent(current.id, { code: { ...current.code, pvoTouched: true,
      pvo: { ...current.code.pvo, style: draft } } }, false);
  }, draft);
  await tab(page, "Advanced").click();
  await tab(page, "Style").click();
  await page.getByRole("alert").filter({ hasText: /Style/ }).waitFor();
  assert.deepEqual((await component(page)).code.pvo, { ...form, style: draft },
    "Opening Advanced leaves every section of an unfinished saved draft untouched");
  const typedDraft = `${draft} `;
  await sourceArea(page, "Style").fill(typedDraft);
  const beforeHistory = await historyLength(page);
  await tab(page, "Structure").click();
  await page.waitForTimeout(450);
  const current = await component(page);
  assert.deepEqual(current.code.pvo, { ...form, style: typedDraft },
    "Leaving an invalid input preserves every byte of the draft");
  assert.deepEqual(current.code.pvoLastValid, previous, "Invalid blur preserves the last valid component");
  assert.equal(await historyLength(page), beforeHistory, "Leaving an invalid draft adds no formatting history entry");
  await assertAutomaticOnly(page);
}

try {
  for (const [type, compact] of [["card", card], ["form", form]]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], requests = [], verifications = [], externalRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", value => { if (value.url().startsWith("https://example.com/")) externalRequests.push(value.url()); });
    await context.route("**/api/assistant/turn", async route => {
      const request = parseNativeTurnRequest(route.request().postDataJSON());
      if (await finishAssistantVerification(route, request)) {
        verifications.push(request);
        return;
      }
      requests.push(request);
      await route.fulfill({ json: componentSourceResult(request, aiSource, "Updated the wording and appearance.") });
    });
    try {
      const { compiledBefore } = await openingRoundTrip(page, type, compact);
      if (type === "card") {
        assert.equal(compiledBefore.structure.title, 'Say "yes" & go');
        assert.equal(compiledBefore.structure.body, "Keep  two spaces, {braces}; café 😀");
        await blurFormatting(page);
        await compactAssistant(page, requests, verifications);
      } else {
        assert.equal(compiledBefore.structure.heading, 'Say "ready" & go');
        assert.equal(compiledBefore.structure.fields[0].label, 'Your "number"');
        assert.equal(compiledBefore.rules[0].action.url, request.url);
        assert.equal(compiledBefore.rules[0].action.body, request.body);
        await invalidStyle(page);
      }
      assert.deepEqual(externalRequests, [], "Formatting and previewing source never send a form request");
      assert.deepEqual(errors, []);
      console.log(`PVO formatting passed: ${type}.`);
    } catch (error) {
      console.error(`${type} UI: ${(await page.locator("body").innerText()).slice(0, 2000)}`);
      throw error;
    } finally {
      await context.close();
    }
  }
  console.log("PVO formatting passed: automatic saved-source/blur formatting, exact compiler equivalence, one-edit undo, untouched drafts and atomic readable AI apply and Undo.");
} finally {
  await browser.close();
}
