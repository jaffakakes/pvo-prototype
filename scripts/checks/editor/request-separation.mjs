import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.setDefaultTimeout(10000);
const errors = [];
const submissions = [];
page.on("pageerror", error => errors.push(error.message));
const button = name => page.getByRole("button", { name, exact: true });
const tab = name => page.getByRole("tab", { name, exact: true }).click();
const component = () => page.evaluate(() => JSON.parse(JSON.stringify(window.capture.getState().components[0])));
const openAction = async () => {
  const row = page.getByRole("button", { name: /When viewers tap/ });
  if (await row.getAttribute("aria-expanded") !== "true") await row.click();
};
const assertNoRequestSettings = async () => {
  for (const name of ["Request settings", "Set up request…", "Save destination"])
    assert.equal(await button(name).count(), 0, `${name} is not part of the editor UI`);
  assert.equal(await page.getByLabel("Destination URL", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("While sending, the button says", { exact: true }).count(), 0);
};

try {
  await page.addInitScript(() => {
    window.pvoReadySources = new WeakSet();
    window.addEventListener("message", event => {
      if (event.data?.kind === "ready" && event.source) window.pvoReadySources.add(event.source);
    });
  });
  await page.route("https://example.com/answers", async route => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { setAdvancedEditingEnabled } = await import("/src/state/preferences/editorPreferences.ts");
    setAdvancedEditingEnabled(false);
    window.capture = useCapture;
    const scene = (id, name) => ({ id, name, parent: id === "main" ? null : "main", clips: [mkClip(20, null, 0)],
      texts: [], components: [], layers: ["video"], muted: true, sound: -1 });
    const main = scene("main", "Main"), next = scene("next", "Next scene");
    useCapture.getState().patch({ scenes: [main, next], currentSceneId: "main", clips: main.clips,
      texts: [], components: [], layers: ["video"], screen: "editor", sheet: "components", t: 2,
      selComp: null, sel: -1, tryMode: null, past: [], future: [] });
    useCapture.getState().addComponent("form");
  });
  assert.equal((await component()).fields.formSubmitMode, "local");
  assert.equal(await page.getByLabel("Destination URL", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Advanced", exact: true }).count(), 0);
  await tab("Action");
  assert.equal(await page.getByLabel("While sending, the button says").count(), 0);
  await openAction();
  if (process.env.PVO_LOCAL_ACTION_SCREENSHOT) await page.screenshot({ path: process.env.PVO_LOCAL_ACTION_SCREENSHOT });
  await page.getByRole("button", { name: /^Jump to a point/ }).click();
  await button("Pick on timeline").click();
  await page.evaluate(() => window.capture.getState().patch({ t: 7 }));
  await button("Use 0:07").click();
  assert.equal((await component()).fields.outcome.t, 7);
  await page.evaluate(() => window.capture.getState().patch({ t: 2 }));
  await button("Try").click();
  await page.locator(".compForm").getByLabel("Name", { exact: true }).fill("Alex");
  await page.locator(".compForm").getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(() => window.capture.getState().t >= 7);
  await button("Stop").click();
  await tab("Action");
  await openAction();
  await page.getByRole("button", { name: /^Go to a scene/ }).click();
  await page.getByRole("button", { name: /Next scene.*0:20/ }).click();
  await button("Try").click();
  await page.locator(".compForm").getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(() => window.capture.getState().currentSceneId === "next");
  await button("Stop").click();
  assert.equal(submissions.length, 0, "Local form actions make no network request");

  await button("More").click();
  await page.getByRole("switch", { name: "Advanced editing", exact: true }).click();
  await page.evaluate(() => window.capture.getState().patch({ sheet: "component" }));
  await tab("Advanced");
  await tab("Logic");
  await assertNoRequestSettings();
  const request = {
    url: "https://example.com/answers", method: "POST",
    body: JSON.stringify({ displayName: `{state.form.${(await component()).id}.field_1}`, source: "advanced" }),
    onSuccess: { kind: "continue" }, onError: null,
  };
  const logic = `on submit {\n  request(${JSON.stringify(request)});\n}`;
  await page.getByLabel("Logic source", { exact: true }).fill(logic);
  await page.waitForFunction(() => {
    const code = window.capture.getState().components[0]?.code;
    return code?.pvoTouched === false && code.pvoCompiled?.rules[0]?.action?.kind === "request";
  });
  assert.equal((await component()).fields.formSubmitMode, "request");
  assert.equal((await component()).code.custom, true, "Typing PVO uses the actual compiled renderer");
  if (process.env.PVO_ADVANCED_REQUEST_SCREENSHOT) await page.screenshot({ path: process.env.PVO_ADVANCED_REQUEST_SCREENSHOT });
  await tab("Content");
  await page.getByLabel("Field 1 name", { exact: true }).fill("Display name");
  assert.equal((await component()).fields.outcome.body, request.body, "Visual wording edits preserve the authored request payload");
  await button("More").click();
  await page.getByRole("switch", { name: "Advanced editing", exact: true }).click();
  await page.evaluate(() => window.capture.getState().patch({ sheet: "component" }));
  await tab("Action");
  await assertNoRequestSettings();
  await button("Open Advanced").waitFor();
  const requestVersion = await component();
  await button("Try").click();
  const renderer = page.locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]').first().contentFrame();
  await renderer.locator('input[name="field_1"]').fill("Alex");
  await page.waitForFunction(() => {
    const frame = document.querySelector('.compCustomRuntime iframe[sandbox="allow-scripts"]');
    return frame && window.pvoReadySources.has(frame.contentWindow);
  });
  const response = page.waitForResponse(value => value.url() === request.url && value.request().method() === "POST");
  await renderer.getByRole("button", { name: "Continue", exact: true }).click();
  await response;
  await page.waitForFunction(() => window.capture.getState().tryMode?.holdingId === null);
  assert.equal(submissions.length, 1, "Hiding Advanced preserves the configured request");
  assert.deepEqual(submissions[0], { displayName: "Alex", source: "advanced" },
    "Authored PVO requests execute through the sandbox with current form values");
  await button("Stop").click();
  await tab("Action");
  await button("Open Advanced").click();
  assert.equal(await page.getByRole("tab", { name: "Logic", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByLabel("Logic source", { exact: true }).inputValue(), requestVersion.code.pvo.logic);
  await assertNoRequestSettings();
  await tab("Action");
  await button("Replace with simple action…").click();
  await page.getByRole("button", { name: /^Continue video/ }).click();
  assert.equal((await component()).fields.formSubmitMode, "local");
  await button("Undo").click();
  assert.deepEqual((await component()).fields, requestVersion.fields);
  await button("Redo").click();
  assert.equal((await component()).fields.formSubmitMode, "local");
  assert.deepEqual(errors, []);
  console.log("Request separation passed: no-code local time/scene actions, source-only Advanced, retained hidden requests, real sandbox submission and undoable local replacement.");
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(0, 2200));
  throw error;
} finally {
  await browser.close();
}
