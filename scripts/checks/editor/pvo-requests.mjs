import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

// Prerequisites: `npm run dev:editor` and Chrome (or CHROME_PATH).
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const requests = [];
const fixture = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  requests.push({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString() });
  response.setHeader("Content-Type", "application/json");
  response.writeHead(200).end(JSON.stringify({ ok: true }));
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const fixturePort = fixture.address().port;

let browser;
let page;
const pageErrors = [];

async function submitForm() {
  await page.getByRole("button", { name: "Try viewer preview" }).click();
  await page.locator(".holdTag").waitFor({ state: "visible", timeout: 5000 });
  const frame = page.locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]').first().contentFrame();
  await frame.locator('input[name="name_0"]').fill("Ada");
  await frame.locator('input[name="email_1"]').fill("ada@example.com");
  await page.waitForTimeout(400); // The renderer can paint before its action Worker is ready.
  await frame.getByRole("button", { name: "Send" }).click();
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: [] });
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => pageErrors.push(error.message));
  const response = await page.goto(editorUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `Editor did not load at ${editorUrl}`);

  // A synthetic clip keeps this check focused on Form authoring and Try playback.
  const componentId = await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    useCapture.getState().patch({ clips: [mkClip(4, null, 0)], screen: "editor", t: 0 });
    const id = useCapture.getState().addComponent("form");
    useCapture.getState().updateComponent(id, { at: 0.15 });
    window.__languageRequestStore = useCapture;
    window.__languageRequestId = id;
    return id;
  });

  const formSheet = page.getByRole("dialog", { name: "Form" });
  await formSheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Collapse component tools" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("dialog", { name: "More" });
  await more.getByRole("switch", { name: "Advanced editing", exact: true }).click();
  await more.getByRole("switch", { name: "Advanced editing", checked: true }).waitFor();
  await more.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Select component layer: form", exact: true }).click();
  await page.locator(".tools").getByRole("button", { name: "Edit", exact: true }).click();
  await formSheet.getByRole("button", { name: "Continue" }).click();
  const outcomeSheet = page.getByRole("dialog", { name: /where\?/ });
  await outcomeSheet.getByRole("button", { name: /Send request/ }).click();
  await outcomeSheet.getByRole("textbox", { name: "Request URL" }).fill(`http://127.0.0.1:${fixturePort}/ok`);
  await outcomeSheet.getByRole("button", { name: "POST" }).click();
  await outcomeSheet.getByRole("textbox", { name: "Request JSON body" }).fill(JSON.stringify({
    name: `{state.form.${componentId}.name_0}`,
    email: `{state.form.${componentId}.email_1}`,
  }));
  await outcomeSheet.getByRole("button", { name: "Back", exact: true }).click();

  await formSheet.getByRole("tab", { name: "Advanced" }).click();
  await formSheet.getByRole("tab", { name: "Logic" }).click();
  const logic = formSheet.getByRole("textbox", { name: "Logic source" });
  assert.match(await logic.inputValue(), /on submit \{\s*request\(/);
  assert.match(await logic.inputValue(), /state\.form\./);
  assert.match(await logic.inputValue(), /onError/);
  await formSheet.getByRole("tab", { name: "Style" }).click();
  await formSheet.getByRole("textbox", { name: "Style source" }).fill("form { color: #F2F0E9; }");
  await page.waitForFunction(() => {
    const state = window.__languageRequestStore.getState();
    const component = state.components.find(item => item.id === window.__languageRequestId);
    return component?.code?.custom && component.code.pvoCompiled?.rules[0]?.action?.kind === "request";
  });
  await formSheet.getByRole("button", { name: "Close" }).click();
  await page.evaluate(() => window.__languageRequestStore.getState().patch({ t: 0, selComp: null }));

  await submitForm();
  await page.locator(".holdTag").waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(requests.length, 1, "Compiled Form did not send exactly one request");
  assert.equal(requests[0].path, "/ok");
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[0].body), { name: "Ada", email: "ada@example.com" });

  await page.getByRole("button", { name: "Stop viewer preview" }).click();
  await page.evaluate(() => window.__languageRequestStore.getState().patch({
    selComp: window.__languageRequestId, sheet: "component", t: 0,
  }));
  await formSheet.getByRole("tab", { name: "Advanced" }).click();
  await formSheet.getByRole("tab", { name: "Logic" }).click();
  await logic.fill((await logic.inputValue()).replace("/ok", "/offline"));
  await page.waitForFunction(() => {
    const state = window.__languageRequestStore.getState();
    const component = state.components.find(item => item.id === window.__languageRequestId);
    return component?.code?.pvoCompiled?.rules[0]?.action?.url?.endsWith("/offline");
  });
  await formSheet.getByRole("button", { name: "Close" }).click();
  await page.evaluate(() => window.__languageRequestStore.getState().patch({ t: 0, selComp: null }));

  await page.route(`http://127.0.0.1:${fixturePort}/offline`, route => route.abort("internetdisconnected"));
  await submitForm();
  await page.locator('[data-try-feedback="failed"]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('[data-notification-id="requestFailed"]').count(), 0,
    "Compiled component request feedback must not duplicate a global notification");
  assert.equal(await page.locator(".holdTag").isVisible(), true,
    "Without an error route, an offline request must leave the Form held for retry");
  assert.equal(requests.length, 1, "The simulated offline request must not reach the fixture");

  await page.unroute(`http://127.0.0.1:${fixturePort}/offline`);
  const retryFrame = page.locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]').first().contentFrame();
  await retryFrame.getByRole("button", { name: "Send" }).click();
  await page.locator(".holdTag").waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(requests.length, 2, "Retry after offline failure did not send a request");
  assert.equal(requests[1].path, "/offline");
  assert.deepEqual(JSON.parse(requests[1].body), { name: "Ada", email: "ada@example.com" });
  assert.deepEqual(pageErrors, []);
  console.log("PVO language request passed: compiled Form POST with field values, offline hold, retry.");
} catch (error) {
  console.error(`PVO language request failed: ${error.message}`);
  console.error(`Page errors: ${pageErrors.join("; ") || "none"}`);
  console.error(`Requests: ${JSON.stringify(requests)}`);
  console.error(`Feedback: ${JSON.stringify(await page?.locator("[data-try-feedback]").allTextContents().catch(() => []))}`);
  console.error(`Component state: ${JSON.stringify(await page?.evaluate(() => {
    const state = window.__languageRequestStore?.getState();
    const component = state?.components.find(item => item.id === window.__languageRequestId);
    return { custom: component?.code?.custom, action: component?.code?.pvoCompiled?.rules[0]?.action, tryMode: state?.tryMode };
  }).catch(() => null))}`);
  console.error(`Visible UI: ${(await page?.locator("body").innerText().catch(() => ""))?.slice(0, 1400)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => fixture.close(resolve));
}
