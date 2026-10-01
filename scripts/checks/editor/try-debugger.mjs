import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// Real sandbox + SDK execution; only the remote HTTP service is a local fixture.
const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const languageUrl = `/@fs/${fileURLToPath(new URL("../../../packages/pvo-language/index.js", import.meta.url)).replaceAll("\\", "/")}`;
let received = 0;
const service = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  received += 1;
  for await (const _chunk of request) { /* Drain the test request. */ }
  const failed = request.url.startsWith("/missing");
  response.writeHead(failed ? 404 : 200).end(JSON.stringify({ score: 3, name: "PRIVATE_NAME", token: "PRIVATE_TOKEN" }));
});
await new Promise(resolve => service.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${service.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

async function seed(path = "/missing") {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Blank project", exact: true }).waitFor();
  await page.evaluate(async ({ endpoint, path, languageUrl }) => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { compilePvoComponent } = await import(languageUrl);
    const { componentLanguageSource, compiledComponentChanges } = await import("/src/domain/components/languageCompilation.ts");
    const { useTryDebugStore } = await import("/src/state/debugging/tryDebugStore.ts");
    const clips = [mkClip(40, null, 0)];
    const scene = { id: "main", name: "Quiz", clips, components: [], texts: [], audioClips: [], muted: false, sound: 0, layers: ["video"] };
    useCapture.setState({ localId: crypto.randomUUID(), scenes: [scene], currentSceneId: "main", clips, components: [], texts: [], audioClips: [], layers: ["video"],
      screen: "editor", t: 0, tryMode: null, sheet: null, sel: -1, selText: null, selComp: null, past: [], future: [] });
    const id = useCapture.getState().addComponent("choice");
    let component = useCapture.getState().components.find(item => item.id === id);
    const source = componentLanguageSource(component);
    source.logic = `on choose(option0) { request(${JSON.stringify({ url: `${endpoint}${path}?key=PRIVATE_QUERY`, method: "POST", body: JSON.stringify({ name: "PRIVATE_NAME", score: 2 }), onSuccess: { kind: "continue" }, onError: null })}); }\non choose(option1) { continue(); }`;
    const compiled = await compilePvoComponent("choice", source);
    component = { ...component, code: { ...component.code, custom: true, pvoTouched: true, pvoLiteral: true } };
    useCapture.getState().updateComponent(id, { ...compiledComponentChanges(component, source, compiled), at: 0, dur: 30,
      responsePolicy: { dispatch: "interaction", unanswered: "pause" } });
    useCapture.getState().patch({ t: 0, sheet: null, selComp: null });
    window.debuggerFixture = { store: useCapture, debug: useTryDebugStore, id };
  }, { endpoint, path, languageUrl });
}

async function clickAnswer() {
  await page.waitForFunction(() => window.debuggerFixture.debug.getState().run?.components[0]?.ready);
  const frame = page.locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]').first().contentFrame();
  await frame.getByRole("button", { name: "Option A", exact: true }).click();
}

async function assertGeometry(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => {
    const element = document.querySelector("[data-debug-workspace]");
    const rect = element.getBoundingClientRect();
    const preview = document.querySelector(".previewArea").getBoundingClientRect();
    return { rect: rect.toJSON(), preview: preview.toJSON(), scroll: document.documentElement.scrollWidth };
  });
  assert(metrics.rect.top > 100 && metrics.rect.bottom <= height + 1, JSON.stringify(metrics));
  assert(metrics.preview.height >= 145, `Video lost at ${width}×${height}: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.scroll, width, `Horizontal overflow at ${width}`);
}

try {
  await seed();
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await clickAnswer();
  await page.waitForFunction(() => window.debuggerFixture.debug.getState().run?.requests.some(row => row.status === 404));
  assert.equal(received, 1);
  const originalRun = await page.evaluate(() => window.debuggerFixture.debug.getState().run.id);
  await page.getByRole("button", { name: /^Debug(?:,|$)/ }).click();
  await page.locator("[data-debug-dock]").waitFor();
  await page.getByRole("tab", { name: /^Requests/ }).click();
  await page.getByRole("option").filter({ hasText: "/missing" }).click();
  assert.match(await page.locator("[data-debug-dock]").innerText(), /404/);
  await page.getByRole("tab", { name: "State", exact: true }).click();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  for (const viewport of [[1440, 900], [1280, 800], [1024, 768], [320, 693], [390, 844], [430, 932]]) {
    await assertGeometry(...viewport);
  }
  assert.equal(await page.evaluate(() => window.debuggerFixture.debug.getState().run.id), originalRun,
    "Rotating/resizing must preserve the same trace");
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  assert.equal(await page.evaluate(() => window.debuggerFixture.debug.getState().run.status), "stopped");
  await page.getByRole("button", { name: "Close Debug", exact: true }).click();
  await page.getByRole("button", { name: /^Last run/ }).click();
  await page.getByRole("button", { name: "Debug options", exact: true }).click();
  await page.getByRole("menuitem", { name: /Copy report/ }).click();
  const report = await page.getByRole("dialog", { name: "Copy report" }).innerText();
  assert(!/PRIVATE_NAME|PRIVATE_QUERY|PRIVATE_TOKEN/.test(report), "Report leaked private request data");
  await page.getByRole("button", { name: "Back to Debug", exact: true }).click();
  await page.getByRole("button", { name: "Close Debug", exact: true }).click();
  await page.getByRole("button", { name: "Try", exact: true }).click();
  assert.notEqual(await page.evaluate(() => window.debuggerFixture.debug.getState().run.id), originalRun);
  assert.equal(await page.evaluate(() => window.debuggerFixture.debug.getState().run.requests.length), 0);
  assert.equal(await page.evaluate(() => window.debuggerFixture.debug.getState().captureData), false);
  assert.deepEqual(errors, []);
  console.log("Try debugger passed: real request 404 trace, default-off privacy, desktop/mobile layout, retained last run, reset and sanitized report.");
} catch (error) {
  console.error(await page.evaluate(() => ({
    body: document.body.innerText.slice(-5000),
    run: window.debuggerFixture?.debug.getState().run,
    trying: !!window.debuggerFixture?.store.getState().tryMode,
  })));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => service.close(resolve));
}
