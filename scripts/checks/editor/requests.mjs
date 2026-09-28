import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";

const requests = [];
const fixture = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString() });
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/fail") res.writeHead(503).end(JSON.stringify({ ok: false }));
  else res.writeHead(200).end(JSON.stringify({ ok: true }));
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const port = fixture.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: [] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

async function setRoute(path, onError = null) {
  await page.evaluate(({ port, path, onError }) => {
    const s = window.__requestTestStore.getState();
    s.updateOutcome(window.__requestTestId, { kind: "form" }, {
      kind: "request", url: `http://127.0.0.1:${port}${path}`, method: "POST",
      body: JSON.stringify({ name: `{state.form.${window.__requestTestId}.name_0}` }),
      onSuccess: { kind: "continue" }, onError,
    });
    s.patch({ t: 0, sheet: null, selComp: null, screen: "editor" });
  }, { port, path, onError });
}

async function startAndSubmit() {
  await page.getByRole("button", { name: "Try viewer preview" }).click();
  await page.locator(".holdTag").waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("textbox", { name: "Name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await page.locator(".compForm").getByRole("button", { name: "Send" }).click();
}

try {
  await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const s = useCapture.getState();
    s.patch({ clips: [mkClip(4, null, 0)], screen: "editor", t: 0 });
    const id = useCapture.getState().addComponent("form");
    useCapture.getState().updateComponent(id, { at: .15 });
    useCapture.getState().patch({ sheet: null, selComp: null, t: 0 });
    window.__requestTestStore = useCapture;
    window.__requestTestId = id;
  });

  // Author the first request through the actual Fields sheet.
  const componentId = await page.evaluate(() => window.__requestTestId);
  await page.evaluate(() => window.__requestTestStore.getState().patch({ selComp: window.__requestTestId, sheet: "component" }));
  await page.getByRole("dialog", { name: "Form" }).getByRole("button", { name: "Continue" }).click();
  const outcomeDialog = page.getByRole("dialog", { name: /where\?/ });
  await outcomeDialog.getByRole("button", { name: /Send request/ }).click();
  await outcomeDialog.getByRole("textbox", { name: "Request URL" }).fill(`http://127.0.0.1:${port}/ok`);
  await outcomeDialog.getByRole("button", { name: "POST" }).click();
  await outcomeDialog.getByRole("textbox", { name: "Request JSON body" }).fill(JSON.stringify({ name: `{state.form.${componentId}.name_0}` }));
  assert.match(await outcomeDialog.innerText(), new RegExp(`127\\.0\\.0\\.1:${port}`), "The editor did not show the allowed host");
  if (process.env.PVO_REQUEST_UI_SHOT) await outcomeDialog.screenshot({ path: process.env.PVO_REQUEST_UI_SHOT });
  await outcomeDialog.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("dialog", { name: "Form" }).getByRole("button", { name: "Close" }).click();
  const exported = await page.evaluate(async () => {
    const { buildPvoManifest } = await import("/src/domain/export/manifest.ts");
    const s = window.__requestTestStore.getState();
    return buildPvoManifest(s, [{ scene: s.scenes[0], assetId: "test-video", name: "test.webm", type: "video/webm" }]);
  });
  assert.deepEqual(exported.allowed_domains, [`127.0.0.1:${port}`], "Field request host was not declared");
  const action = exported.components[0].on_submit;
  assert.equal(action.type, "request", "Form after-submit did not export as a request action");
  assert.equal(action.method, "POST");
  assert.equal(action.body.name, `{state.form.${exported.components[0].id}.name_0}`);
  assert.equal(action.on_success.type, "custom", "Success should continue, not split the scene");
  assert.equal(action.on_error, undefined, "Default failure should not take a playback route");
  assert.equal(exported.components[0].scene_change, undefined, "Request should not create an implicit scene branch");

  // Manual request hosts belong to the project, not to one component's PVO Logic tab.
  await page.evaluate(() => window.__requestTestStore.getState().patch({ selComp: null, sheet: null }));
  await page.getByRole("button", { name: "More", exact: true }).click();
  const moreDialog = page.getByRole("dialog", { name: "More" });
  await moreDialog.getByRole("heading", { name: "Advanced", exact: true }).waitFor({ state: "visible" });
  const allowedDomains = moreDialog.getByRole("textbox", { name: "Allowed request domains" });
  await allowedDomains.fill("api.example.com");
  const advancedEditing = moreDialog.getByRole("switch", { name: "Advanced editing", exact: true });
  assert.equal(await advancedEditing.getAttribute("aria-checked"), "false",
    "Component code editing starts disabled; project request hosts remain configurable");
  await advancedEditing.click();
  await moreDialog.getByRole("switch", { name: "Advanced editing", checked: true }).waitFor();
  await moreDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.evaluate(() => window.__requestTestStore.getState().patch({ selComp: window.__requestTestId, sheet: "component" }));
  const componentDialog = page.getByRole("dialog", { name: "Form" });
  await componentDialog.getByRole("tab", { name: "Advanced", exact: true }).click();
  await componentDialog.getByRole("tab", { name: "Logic", exact: true }).click();
  assert.equal(await componentDialog.getByRole("textbox", { name: "Allowed request domains" }).count(), 0,
    "Project-wide request hosts should not be edited inside a component");
  const projectDomains = await page.evaluate(async () => {
    const { buildPvoManifest } = await import("/src/domain/export/manifest.ts");
    const s = window.__requestTestStore.getState();
    return buildPvoManifest(s, [{ scene: s.scenes[0], assetId: "test-video", name: "test.webm", type: "video/webm" }]).allowed_domains;
  });
  assert.deepEqual(projectDomains.toSorted(), [`127.0.0.1:${port}`, "api.example.com"].toSorted(),
    "Project-wide manual hosts must be included in the PVO allow-list");
  await componentDialog.getByRole("button", { name: "Close", exact: true }).click();

  await startAndSubmit();
  await page.waitForFunction(() => !document.querySelector(".holdTag"), null, { timeout: 5000 });
  assert.equal(requests.length, 1, "Try mode did not send the field request");
  assert.deepEqual(JSON.parse(requests[0].body), { name: "Ada" }, "Form value template was not resolved");

  if (await page.getByRole("button", { name: "Stop viewer preview" }).count()) {
    await page.getByRole("button", { name: "Stop viewer preview" }).click();
  }
  await setRoute("/fail");
  await startAndSubmit();
  await page.locator('[data-try-feedback="failed"]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('[data-notification-id="requestFailed"]').count(), 0,
    "Component request feedback must not be duplicated as a global notification");
  assert.equal(await page.locator(".holdTag").isVisible(), true, "Failed request incorrectly took the success route");
  assert.equal(requests.length, 2);

  await page.getByRole("button", { name: "Stop viewer preview" }).click();
  await setRoute("/fail", { kind: "continue" });
  await startAndSubmit();
  await page.waitForFunction(() => !document.querySelector(".holdTag"), null, { timeout: 5000 });
  assert.equal(requests.length, 3, "Explicit error route did not execute after a failed request");

  assert.deepEqual(errors, [], "Uncaught browser errors occurred");
  console.log(JSON.stringify({ status: "ok", requestHosts: projectDomains, postBody: JSON.parse(requests[0].body), failedRequestStayedHeld: true, explicitErrorContinued: true }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => fixture.close(resolve));
}
