import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { packPvoProject, PVO_SPEC_VERSION } from "../../../packages/pvo-sdk/index.js";

const playerUrl = process.env.PVO_PLAYER_URL || "http://127.0.0.1:4173/player/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const video = await readFile(new URL("../../../assets/pvo-demo.mp4", import.meta.url));
const received = [];
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", new URL(playerUrl).origin);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  received.push({ path: request.url, method: request.method, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
  // Leave the real request pending long enough to inspect its submitting state.
  await new Promise(resolve => setTimeout(resolve, request.url === "/early" ? 650 : 250));
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const host = `127.0.0.1:${port}`;
const next = { type: "custom", name: "restyle_continue" };
const manifest = {
  spec_version: PVO_SPEC_VERSION,
  initial_scene: "main",
  canvas: { ratio: "9:16", width: 9, height: 16 },
  restyle_capture: { version: 1 },
  allowed_domains: [host],
  media: [{ id: "main", asset_id: "video", name: "media/main.mp4", type: "video/mp4" }],
  scenes: [{ id: "main", label: "Main", asset_id: "video", start: 0, end: 2 }],
  playback: { initial_timeline: "timeline-main", timelines: [{
    id: "timeline-main", kind: "main", clips: [{ id: "clip-main", scene: "main", asset_id: "video", start: 0, end: 2 }],
  }] },
  components: [
    {
      id: "choice", kind: "choice", title: "Send choice?",
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      presentation: { scene: "main", start: .3, end: .35, x: .1, y: .2, width: .8, height: .4 },
      options: [
        { label: "Send", action: { type: "request", url: `http://${host}/choice`, method: "POST",
          body: { choice: "A" }, on_success: [next] } },
        { label: "Skip", action: next },
      ],
      restyle_capture: { version: 1, at: .3, dur: null, x: 50, y: 40,
        outcomes: [{ kind: "continue" }, { kind: "continue" }] },
    },
    {
      id: "form", kind: "form", title: "Name",
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      presentation: { scene: "main", start: .8, end: .85, x: .1, y: .25, width: .8, height: .4 },
      fields: [{ name: "name_0", label: "Name", type: "text", required: true }],
      submit_label: "Send", on_submit: { type: "request", url: `http://${host}/form`, method: "POST",
        body: { name: "{state.form.form.name_0}" }, on_success: [next] },
      restyle_capture: { version: 1, at: .8, dur: null, x: 50, y: 45,
        outcomes: [{ kind: "continue" }] },
    },
  ],
};
const packageBlob = await packPvoProject({ manifest,
  assets: [{ id: "video", name: "media/main.mp4", blob: new Blob([video], { type: "video/mp4" }) }] });
const exactIndexManifest = {
  spec_version: PVO_SPEC_VERSION,
  initial_scene: "main",
  canvas: { ratio: "9:16", width: 9, height: 16 },
  allowed_domains: [host],
  media: [{ id: "main", asset_id: "video", name: "media/main.mp4", type: "video/mp4" }],
  scenes: [{ id: "main", label: "Main", asset_id: "video", start: 0, end: 2 }],
  playback: { initial_timeline: "timeline-main", timelines: [{
    id: "timeline-main", kind: "main", clips: [{ id: "clip-main", scene: "main", asset_id: "video", start: 0, end: 2 }],
  }] },
  components: [{
    id: "four-choice", kind: "choice", title: "Choose one of four",
    html: "<div><h3>Choose one of four</h3><button>One</button><button>Two</button><button>Three</button><button>Four</button></div>",
    css: "button { display: block; min-height: 32px; width: 100%; }",
    response_policy: { dispatch: "interaction", unanswered: "pause" },
    presentation: { scene: "main", start: .3, end: .35, x: .1, y: .2, width: .8, height: .5 },
    options: [
      { label: "One", action: next },
      { label: "Two", action: next },
      { label: "Three", action: next },
      { label: "Four", action: { type: "request", url: `http://${host}/fourth`, method: "POST",
        body: { choice: "D" }, on_success: [next] } },
    ],
  }],
};
const exactIndexPackage = await packPvoProject({
  manifest: exactIndexManifest,
  assets: [{ id: "video", name: "media/main.mp4", blob: new Blob([video], { type: "video/mp4" }) }],
});
const earlyManifest = {
  ...manifest,
  scenes: [{ id: "main", label: "Early response", asset_id: "video", start: 0, end: 4 }],
  playback: { initial_timeline: "timeline-main", timelines: [{ id: "timeline-main", kind: "main",
    clips: [{ id: "clip-main", scene: "main", asset_id: "video", start: 0, end: 4 }] }] },
  components: [{
    ...manifest.components[1], id: "early-form", title: "Early answer",
    presentation: { scene: "main", start: 0, end: 3, x: .1, y: .25, width: .8, height: .4 },
    restyle_capture: { version: 1, at: 0, dur: 3, x: 50, y: 45, outcomes: [{ kind: "continue" }] },
    on_submit: { type: "request", url: `http://${host}/early`, method: "POST",
      body: { name: "{state.form.early-form.name_0}" }, on_success: [next] },
  }],
};
const earlyPackage = await packPvoProject({ manifest: earlyManifest,
  assets: [{ id: "video", name: "media/main.mp4", blob: new Blob([video], { type: "video/mp4" }) }] });
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const browserErrors = [];
await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
page.on("pageerror", (error) => browserErrors.push(error.message));

try {
  const response = await page.goto(playerUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  await page.locator("#pvoInput").setInputFiles({ name: "actions.pvo", mimeType: "application/vnd.pvo",
    buffer: Buffer.from(await packageBlob.arrayBuffer()) });
  const choice = page.locator("pvo-component-view").filter({ hasText: "Send choice?" });
  await choice.getByRole("button", { name: "Send" }).waitFor({ state: "visible", timeout: 10000 });
  await context.setOffline(true);
  await choice.getByRole("button", { name: "Send" }).click();
  await page.locator("#retryButton").waitFor({ state: "visible" });
  assert.match(await page.locator("#holdStatus").textContent(), /Couldn't send/);
  assert.equal(await page.locator("#status.error.is-visible").count(), 0,
    "A failed answer should have one feedback surface.");
  assert.equal(await page.locator("#video").getAttribute("data-asset-id"), "video");
  assert.equal(await page.locator("#video").evaluate((element) => element.paused), true,
    "An offline request without on_error must leave the Choice held.");
  assert.equal(received.length, 0, "Offline requests must not be queued or sent.");
  await context.setOffline(false);
  const missingRoute = `http://${host}/choice`;
  let missingRequests = 0;
  await page.route(missingRoute, route => {
    if (route.request().method() !== "POST") return route.continue();
    missingRequests += 1;
    return route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": new URL(playerUrl).origin }, body: "Not found" });
  });
  await page.locator("#retryButton").click();
  await page.locator('#playerFrame[data-state="error"]').waitFor();
  assert.match(await page.locator("#holdStatus").textContent(), /Couldn't send/);
  assert.equal(missingRequests, 1, "One Retry press must issue exactly one new request.");
  assert.equal(received.length, 0, "A missing route must not count as a delivered answer.");
  await page.unroute(missingRoute);
  await page.locator("#retryButton").click();
  await page.locator('#playerFrame[data-state="submitting"]').waitFor();
  assert.match(await page.locator("#holdStatus").textContent(), /Sending…/);
  const form = page.locator("pvo-component-view").filter({ hasText: "Name" });
  await form.getByRole("textbox", { name: "Name" }).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(received.length, 1, "The successful Retry must not duplicate the answer.");
  assert.deepEqual(received[0], { path: "/choice", method: "POST", body: { choice: "A" } });
  assert.equal(await page.locator("#video").getAttribute("data-asset-id"), "video",
    "A Choice action must not implicitly create a branch timeline.");
  const mutedBeforeTyping = await page.locator("#video").evaluate(element => element.muted);
  await form.getByRole("textbox", { name: "Name" }).fill("Ada");
  await page.keyboard.press("m");
  assert.equal(await page.locator("#video").evaluate(element => element.muted), mutedBeforeTyping,
    "Typing in a form must not trigger the mute shortcut.");
  await form.getByRole("textbox", { name: "Name" }).fill("Ada");
  await form.getByRole("button", { name: "Send" }).click();
  await page.locator('#playerFrame[data-state="submitting"]').waitFor();
  await page.locator("#endScreen").waitFor({ state: "visible", timeout: 10000 });
  assert.deepEqual(received[1], { path: "/form", method: "POST", body: { name: "Ada" } });

  await page.locator("#pvoInput").setInputFiles({ name: "exact-index.pvo", mimeType: "application/vnd.pvo",
    buffer: Buffer.from(await exactIndexPackage.arrayBuffer()) });
  const fourChoice = page.locator("pvo-component-view").filter({ hasText: "Choose one of four" });
  const fourth = fourChoice.getByRole("button", { name: "Four", exact: true });
  await fourth.waitFor({ state: "visible", timeout: 10000 });
  await fourth.click();
  for (let attempt = 0; attempt < 50 && received.length < 3; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(received[2], { path: "/fourth", method: "POST", body: { choice: "D" } });
  assert.equal(await fourChoice.getByRole("button", { name: "Four", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await fourChoice.getByRole("button", { name: "One", exact: true }).getAttribute("aria-pressed"), "false");

  await page.locator("#pvoInput").setInputFiles({ name: "early-form.pvo", mimeType: "application/vnd.pvo",
    buffer: Buffer.from(await earlyPackage.arrayBuffer()) });
  const earlyForm = page.locator("pvo-component-view").filter({ hasText: "Early answer" });
  await earlyForm.getByRole("textbox", { name: "Name" }).fill("Grace");
  const beforeSubmit = await page.locator("#video").evaluate(element => ({ time: element.currentTime, paused: element.paused }));
  assert.equal(beforeSubmit.paused, false, "The early form is answered while footage is playing.");
  assert.ok(beforeSubmit.time < 2.5, "Submit before the authored hold boundary.");
  await earlyForm.getByRole("button", { name: "Send" }).click();
  await page.locator('#playerFrame[data-state="submitting"]').waitFor();
  const pendingTime = await page.locator("#video").evaluate(element => element.currentTime);
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#video").evaluate(element => element.paused), true,
    "An early submission must hold playback until its request resolves.");
  assert.ok(Math.abs(await page.locator("#video").evaluate(element => element.currentTime) - pendingTime) < .05);
  assert.match(await page.locator("#holdStatus").textContent(), /Sending…/);
  await page.waitForFunction(time => {
    const video = document.querySelector("#video");
    return !video.paused && video.currentTime > time + .1;
  }, pendingTime);
  assert.deepEqual(received[3], { path: "/early", method: "POST", body: { name: "Grace" } });
  assert.deepEqual(browserErrors, []);
  console.log("Player actions passed: Choice and Form requests, offline and 404 feedback, one request per Retry, early-submission holds, form state, exact four-option index, no implicit branch.");
} catch (error) {
  console.error(`Player actions failed: ${error.message}`);
  console.error(`Status: ${await page.locator("#holdStatus").textContent().catch(() => "unavailable")}`);
  console.error(`Requests: ${JSON.stringify(received)}`);
  console.error(`Browser errors: ${browserErrors.join("; ") || "none"}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
