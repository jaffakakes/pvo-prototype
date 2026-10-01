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
      body: JSON.stringify({ name: `{state.form.${window.__requestTestId}.field_1}` }),
      onSuccess: { kind: "continue" }, onError,
    });
    s.patch({ t: 0, sheet: null, selComp: null, screen: "editor" });
  }, { port, path, onError });
}

async function startAndSubmit() {
  await page.getByRole("button", { name: "Try", exact: true }).click();
  const frame = page.locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]').first().contentFrame();
  await frame.getByRole("textbox", { name: "Name" }).fill("Ada");
  await frame.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await page.waitForTimeout(400);
  await frame.getByRole("button", { name: "Send" }).click();
}

async function waitForRequestCount(count) {
  for (let attempt = 0; attempt < 100 && requests.length < count; attempt += 1)
    await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(requests.length, count, `Expected ${count} request${count === 1 ? "" : "s"}`);
}

try {
  await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const s = useCapture.getState();
    s.patch({ clips: [mkClip(4, null, 0)], screen: "editor", t: 0 });
    const id = useCapture.getState().addComponent("form");
    const component = useCapture.getState().components.find(item => item.id === id);
    useCapture.getState().updateComponent(id, {
      at: .15,
      responsePolicy: { dispatch: "layer_end", unanswered: "pause" },
      fields: { ...component.fields, submitLabel: "Send" },
    });
    useCapture.getState().patch({ sheet: null, selComp: null, t: 0 });
    window.__requestTestStore = useCapture;
    window.__requestTestId = id;
  });

  // Request actions are authored in Advanced; project request hosts remain separate.
  const componentId = await page.evaluate(() => window.__requestTestId);
  await page.locator(".toolBar").getByRole("button", { name: "More", exact: true }).click();
  const moreDialog = page.getByRole("dialog", { name: "More" });
  await moreDialog.waitFor({ state: "visible" });
  const advancedEditing = moreDialog.getByRole("switch", { name: "Advanced editing", exact: true });
  assert.equal(await advancedEditing.getAttribute("aria-checked"), "false",
    "Component code editing starts disabled");
  await advancedEditing.click();
  await moreDialog.getByRole("switch", { name: "Advanced editing", checked: true }).waitFor();
  await moreDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.evaluate(() => window.__requestTestStore.getState().patch({ selComp: window.__requestTestId, sheet: "component" }));
  const componentDialog = page.getByRole("dialog", { name: "Form" });
  await componentDialog.getByRole("tab", { name: "Advanced", exact: true }).click();
  await componentDialog.getByRole("tab", { name: "Logic", exact: true }).click();
  const authoredRequest = {
    url: `http://127.0.0.1:${port}/ok`, method: "POST",
    body: JSON.stringify({ name: `{state.form.${componentId}.field_1}` }),
    onSuccess: { kind: "continue" }, onError: null,
  };
  await componentDialog.getByRole("textbox", { name: "Logic source", exact: true })
    .fill(`on submit { request(${JSON.stringify(authoredRequest)}); }`);
  await componentDialog.getByText("✓ Valid · preview updated", { exact: true }).waitFor();
  assert.match(await componentDialog.getByRole("textbox", { name: "Logic source", exact: true }).inputValue(),
    new RegExp(`127\\.0\\.0\\.1:${port}`));
  if (process.env.PVO_REQUEST_UI_SHOT) await componentDialog.screenshot({ path: process.env.PVO_REQUEST_UI_SHOT });
  await componentDialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForFunction(() => {
    const component = window.__requestTestStore.getState().components.find(item => item.id === window.__requestTestId);
    return component?.code?.pvoTouched === false && !!component.code.pvoCompiled;
  });

  const exported = await page.evaluate(async () => {
    const { buildPvoManifest } = await import("/src/domain/export/manifest.ts");
    const s = window.__requestTestStore.getState();
    const component = s.components.find(item => item.id === window.__requestTestId);
    const languages = new Map([[component.id, { source: component.code.pvo, compiled: component.code.pvoCompiled }]]);
    return buildPvoManifest(s, [{ scene: s.scenes[0], assetId: "test-video", name: "test.webm", type: "video/webm" }], languages);
  });
  assert.deepEqual(exported.allowed_domains, [`127.0.0.1:${port}`], "Field request host was not declared");
  const action = exported.components[0].on_submit;
  assert.equal(action.type, "request", "Form after-submit did not export as a request action");
  assert.equal(action.method, "POST");
  assert.equal(action.body.name, `{state.form.${exported.components[0].id}.field_1}`);
  assert.equal(action.on_success.type, "custom", "Success should continue, not split the scene");
  assert.equal(action.on_error, undefined, "Default failure should not take a playback route");
  assert.deepEqual(exported.components[0].response_policy,
    { dispatch: "layer_end", unanswered: "pause" },
    "Request timing should use the component response policy");

  const projectDomains = await page.evaluate(async () => {
    const { buildPvoManifest } = await import("/src/domain/export/manifest.ts");
    const s = window.__requestTestStore.getState();
    const component = s.components.find(item => item.id === window.__requestTestId);
    const languages = new Map([[component.id, { source: component.code.pvo, compiled: component.code.pvoCompiled }]]);
    return buildPvoManifest(s, [{ scene: s.scenes[0], assetId: "test-video", name: "test.webm", type: "video/webm" }], languages).allowed_domains;
  });
  assert.deepEqual(projectDomains, [`127.0.0.1:${port}`],
    "The authored request host must be included in the PVO allow-list");

  await startAndSubmit();
  await waitForRequestCount(1);
  await page.waitForFunction(() => {
    const mode = window.__requestTestStore.getState().tryMode;
    return !mode || mode.holdingId === null;
  }, null, { timeout: 5000 });
  assert.deepEqual(JSON.parse(requests[0].body), { name: "Ada" }, "Form value template was not resolved");

  if (await page.getByRole("button", { name: "Stop trying", exact: true }).count()) {
    await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  }
  await setRoute("/fail");
  await startAndSubmit();
  await waitForRequestCount(2);
  await page.locator('[data-try-feedback="failed"]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('[data-notification-id="requestFailed"]').count(), 0,
    "Component request feedback must not be duplicated as a global notification");
  assert.equal(await page.evaluate(() => window.__requestTestStore.getState().tryMode?.holdingId), componentId,
    "Failed request incorrectly released its response boundary");

  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  await setRoute("/fail", { kind: "continue" });
  await startAndSubmit();
  await waitForRequestCount(3);
  await page.waitForFunction(() => {
    const mode = window.__requestTestStore.getState().tryMode;
    return !mode || mode.holdingId === null;
  }, null, { timeout: 5000 });

  assert.deepEqual(errors, [], "Uncaught browser errors occurred");
  console.log(JSON.stringify({ status: "ok", requestHosts: projectDomains, postBody: JSON.parse(requests[0].body), failedRequestStayedHeld: true, explicitErrorContinued: true }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => fixture.close(resolve));
}
