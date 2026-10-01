import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

const component = () => page.evaluate(() => window.capture.getState().components.find(item => item.id === window.capture.getState().selComp));
const history = () => page.evaluate(() => window.capture.getState().past.length);
const tab = name => page.getByRole("tab", { name, exact: true }).click();

try {
  await page.addInitScript(() => {
    window.pvoReadySources = new WeakSet();
    window.addEventListener("message", event => {
      if (event.data?.kind === "ready" && event.source) window.pvoReadySources.add(event.source);
    });
  });
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    window.capture = (await import("/src/store.ts")).useCapture;
    const state = window.capture.getState();
    const clip = { id: 1, url: null, color: "#4d4257", srcDur: 20, in: 0, out: 20, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "cover" };
    const scene = { id: "main", name: "Main", parent: null, clips: [clip], texts: [], components: [], muted: true, sound: -1, layers: ["video"] };
    state.patch({ scenes: [scene], currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"], screen: "editor", sheet: "components", selComp: null, t: 4, past: [], future: [] });
  });
  await page.getByRole("button", { name: /Let viewers choose/ }).click();
  await page.getByLabel("Prompt", { exact: true }).fill("Which look?");
  await page.getByLabel("Option 1", { exact: true }).fill("Street");
  await page.getByLabel("Option 2", { exact: true }).fill("Evening");
  await tab("Look");
  const beforePreset = await component();
  await page.getByRole("button", { name: "Soft", exact: true }).first().click();
  const afterPreset = await component();
  assert.deepEqual(afterPreset.fields, beforePreset.fields);
  for (const key of ["at", "dur", "x", "y"]) assert.equal(afterPreset[key], beforePreset[key]);
  assert.deepEqual(afterPreset.responsePolicy, beforePreset.responsePolicy);
  assert.equal(afterPreset.look.preset, "soft");
  await page.getByRole("dialog", { name: "Choice", exact: true }).getByRole("button", { name: "Street", exact: true }).click();
  await page.getByRole("button", { name: "XL", exact: true }).click();
  assert.equal((await component()).look.btns[0].size, "XL");
  assert.equal((await component()).look.btns[1].size, "M");
  await tab("Content");
  const beforeTyping = await history();
  await page.getByLabel("Prompt", { exact: true }).focus();
  await page.getByLabel("Prompt", { exact: true }).pressSequentially(" today");
  await tab("Action");
  assert.equal(await history(), beforeTyping + 1, "Typing groups history per focus");
  await page.getByRole("button", { name: /When viewers tap “Street”/ }).click();
  await page.getByRole("button", { name: /Jump to a point/ }).click();
  await page.getByRole("button", { name: "Pick on timeline", exact: true }).click();
  await page.evaluate(() => window.capture.getState().patch({ t: 7 }));
  await page.getByRole("button", { name: /^Use 0:07$/ }).click();
  assert.equal((await component()).fields.options[0].outcome.t, 7);
  assert.equal(await page.getByRole("tab", { name: "Action", exact: true }).getAttribute("aria-selected"), "true");
  await tab("Content");
  await page.getByRole("button", { name: "Pick on timeline", exact: true }).click();
  await page.evaluate(() => window.capture.getState().patch({ t: 10 }));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => window.capture.getState().t), 7, "Cancel restores playhead");
  await tab("Look");
  for (const [width, height] of [[320, 693], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px no page overflow`);
    const player = await page.locator(".previewArea").boundingBox();
    const sheet = await page.getByRole("dialog").boundingBox();
    assert(player.height >= (width <= 320 ? 150 : 190) - 1, `${width}px visible video`);
    assert(player.y + player.height <= sheet.y, "Sheet cannot cover player");
  }
  if (process.env.PVO_NO_CODE_SCREENSHOT) await page.screenshot({ path: process.env.PVO_NO_CODE_SCREENSHOT });
  const heightBeforeTry = (await page.locator(".editorDock").boundingBox()).height;
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.getByRole("tab", { name: "Look", exact: true }).getAttribute("aria-selected"), "true");
  assert(Math.abs((await page.locator(".editorDock").boundingBox()).height - heightBeforeTry) <= 1);

  await page.getByRole("button", { name: "More", exact: true }).click();
  const advancedSwitch = page.getByRole("switch", { name: "Advanced editing", exact: true });
  if (await advancedSwitch.getAttribute("aria-checked") !== "true") await advancedSwitch.click();
  await page.evaluate(() => window.capture.getState().patch({ sheet: "component" }));
  await tab("Advanced");
  const structure = page.getByRole("textbox", { name: "Structure source", exact: true });
  assert.equal(await structure.isEditable(), true, "Advanced is another editable view of the same component");
  assert.equal(await page.getByRole("button", { name: "Take over with code", exact: true }).count(), 0);
  await structure.fill((await structure.inputValue()).replace(/<prompt>[^<]*<\/prompt>/, "<prompt>One component, two views</prompt>"));
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  await tab("Content");
  assert.equal(await page.getByLabel("Prompt", { exact: true }).isDisabled(), false);
  assert.equal(await page.getByLabel("Prompt", { exact: true }).inputValue(), "One component, two views");
  await page.getByLabel("Prompt", { exact: true }).fill("Back in the visual tools");
  await tab("Advanced");
  assert.match(await structure.inputValue(), /Back in the visual tools/);
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  const style = page.getByRole("textbox", { name: "Style source", exact: true });
  const validStyle = (await style.inputValue()) + "\n#option0 { font-size: 21px; }";
  await style.fill(validStyle);
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  await tab("Look");
  await page.getByRole("dialog", { name: "Choice", exact: true }).getByRole("button", { name: "Street", exact: true }).click();
  await page.getByText("Custom · 21px", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Fill: #FF9FBC", exact: true }).click();
  assert.match((await component()).code.pvo.style, /font-size: 21px/,
    "Changing one visual property preserves exact custom sizes");
  await tab("Advanced");
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  const savedStyle = await style.inputValue();
  await style.fill(savedStyle + "\nchoice { color: unfinished");
  await page.locator('[data-state="invalid"]').waitFor();
  await tab("Content");
  assert.equal(await page.getByLabel("Prompt", { exact: true }).isDisabled(), true,
    "An unfinished draft must not be overwritten by visual edits");
  assert((await component()).code.pvo.style.endsWith("unfinished"));
  await page.getByRole("button", { name: "Restore previous version", exact: true }).click();
  await page.waitForFunction(() => !window.capture.getState().components.find(item => item.id === window.capture.getState().selComp).code.pvoTouched);
  assert.equal(await page.getByLabel("Prompt", { exact: true }).isDisabled(), false);
  assert.equal((await component()).code.pvo.style, savedStyle);

  await page.evaluate(() => window.capture.getState().patch({ sheet: "components", selComp: null }));
  await page.getByRole("button", { name: /Ask for details/ }).click();
  await page.getByRole("button", { name: "Add a field", exact: false }).click();
  await page.getByLabel("Field 3 name", { exact: true }).fill("Age");
  await page.getByLabel("Field 3 answer type").getByRole("button", { name: "A number", exact: true }).click();
  assert.deepEqual((await component()).fields.formFields[2], { name: "Age", type: "number" });
  await page.getByLabel("Submit button", { exact: true }).fill("Send");
  assert.equal(await page.getByLabel("Destination URL", { exact: true }).count(), 0);
  await tab("Advanced");
  await tab("Structure");
  await structure.fill((await structure.inputValue()).replace(/waiting="[^"]*"/, 'waiting="One moment…"'));
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  assert.equal((await component()).fields.waitingLabel, "One moment…");
  await tab("Logic");
  assert.equal(await page.getByRole("button", { name: "Request settings", exact: true }).count(), 0);
  const currentForm = await component();
  const request = {
    url: "https://example.com/answers", method: "POST",
    body: JSON.stringify({ answers: currentForm.fields.formFields.map((field, index) => ({
      name: field.name, type: field.type, value: `{state.form.${currentForm.id}.field_${index + 1}}`,
    })) }),
    onSuccess: { kind: "continue" }, onError: null,
  };
  await page.getByRole("textbox", { name: "Logic source", exact: true })
    .fill(`on submit { request(${JSON.stringify(request)}); }`);
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  assert.equal((await component()).fields.destination, "https://example.com/answers");
  const submitted = [];
  await page.route("https://example.com/answers", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } });
      return;
    }
    submitted.push(route.request().postDataJSON());
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"received":true}', headers: { "access-control-allow-origin": "*" } });
  });
  await page.evaluate(id => {
    const renderer = document.querySelector(`iframe[title="Component ${id}"][sandbox="allow-same-origin"]`);
    window.formRuntimeBeforeTry = renderer?.closest(".compCustomRuntime").querySelector('iframe[sandbox="allow-scripts"]');
  }, currentForm.id);
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.waitForFunction(id => {
    const renderer = document.querySelector(`iframe[title="Component ${id}"][sandbox="allow-same-origin"]`);
    const runtime = renderer?.closest(".compCustomRuntime").querySelector('iframe[sandbox="allow-scripts"]');
    return runtime && runtime !== window.formRuntimeBeforeTry && window.pvoReadySources.has(runtime.contentWindow);
  }, currentForm.id);
  const form = page.locator(`iframe[title="Component ${currentForm.id}"][sandbox="allow-same-origin"]`).contentFrame();
  await form.getByLabel("Age", { exact: true }).fill("22.5");
  await form.getByRole("button", { name: "Send", exact: true }).click();
  await form.getByRole("button", { name: "One moment…", exact: true }).waitFor();
  await form.getByRole("button", { name: "Send", exact: true }).waitFor();
  assert.equal(await form.getByRole("button", { name: "Send", exact: true }).isEnabled(), true,
    "The completed request clears pending state; handled tracks end-of-layer Choice branches");
  assert.equal(submitted.length, 1, "One explicit submit sends one request");
  assert.equal(submitted[0].answers.find(answer => answer.name === "Age").value, 22.5);
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  await tab("Advanced");
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  const codeForm = await component();
  assert.equal(codeForm.fields.heading, "Get early access");
  assert.deepEqual(codeForm.fields.formFields[2], { name: "Age", type: "number" });
  assert.equal(codeForm.fields.waitingLabel, "One moment…");
  assert.equal(codeForm.fields.destination, "https://example.com/answers");
  await page.getByRole("tab", { name: "Logic", exact: true }).click();
  const customSubmit = {
    url: "https://example.com/answers", method: "POST",
    body: JSON.stringify({ first: `{state.form.${codeForm.id}.field_1}` }),
    onSuccess: { kind: "continue" }, onError: null,
  };
  await page.getByRole("textbox", { name: "Logic source", exact: true })
    .fill(`on submit { request(${JSON.stringify(customSubmit)}); }`);
  await page.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  await tab("Content");
  const beforeRemoval = await component();
  const historyBeforeRemoval = await history();
  await page.getByRole("button", { name: "Remove field 1", exact: true }).click();
  const referenceError = page.getByRole("alert").filter({ hasText: "This field is used by the submit action." });
  await referenceError.waitFor();
  assert.deepEqual(await component(), beforeRemoval, "A custom request reference cannot silently lose its input field");
  assert.equal(await history(), historyBeforeRemoval, "Rejected removal must not consume history");
  await page.getByLabel("Heading", { exact: true }).fill("Join the launch list");
  await referenceError.waitFor({ state: "hidden" });
  assert.equal((await component()).fields.formFields.length, 3);
  if (process.env.PVO_COMPONENT_SYNC_SCREENSHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Heading", { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: process.env.PVO_COMPONENT_SYNC_SCREENSHOT });
  }
  assert.deepEqual(errors, []);
  console.log("No-code components passed: content, presets, part styles, grouped undo, timing pick/cancel, responsive geometry, Try restoration, synchronized visual/PVO edits, exact custom styles, draft recovery, named fields and explicit request/pending/typed response.");
} catch (error) {
  console.error(await page.evaluate(async () => ({
    selection: window.capture?.getState().selComp,
    trying: window.capture?.getState().tryMode,
    feedback: (await import("/src/features/preview/tryFeedbackStore.ts")).useTryFeedback.getState(),
  })));
  console.error((await page.locator("body").innerText()).slice(0, 1800));
  throw error;
} finally {
  await browser.close();
}
