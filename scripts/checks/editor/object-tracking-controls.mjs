import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// This checks manual authoring with real video extraction and a deterministic
// measurement fixture. SAM model quality is assessed separately on the GPU.
const video = await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, serviceWorkers: "block" });
const errors = [], requests = [];
let pending = null, hold = false, available = true;
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
await page.route("**/tracking-fixture.mp4", route => route.fulfill({ body: video, contentType: "video/mp4" }));
await page.route("**/api/assistant/status", route => route.fulfill({ json: {
  provider: "open-source", available: true, model: "fixture", capabilities: { editing: true, frames: true, transcription: true, wordTiming: true, objectTracking: available },
  chatgpt: { available: false, reason: "hosted_access_required", message: "Fixture", documentationUrl: "https://developers.openai.com/siwc/token-sharing-open-source" },
} }));
const reply = async (route, request) => route.fulfill({ json: { model: "sam3.1", width: request.width, height: request.height,
  frames: request.frames.map(frame => ({ time: frame.time, visible: true, x: .3 + .2 * (frame.time - request.start) / (request.end - request.start),
    y: .5, width: .2, height: .2, score: .9 })),
} }).catch(() => {});
await page.route("**/api/assistant/track", async route => {
  const request = route.request().postDataJSON(); requests.push(request);
  if (hold) pending = { route, request }; else await reply(route, request);
});
const waitPending = async () => {
  const deadline = Date.now() + 15000;
  while (!pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert(pending, "The captured request reached the tracking endpoint");
};
const release = async () => { const response = pending; pending = null; await reply(response.route, response.request); };
const controls = () => page.locator("[data-keyframe-editor]").filter({ visible: true });
const applied = () => page.evaluate(() => window.trackingControls.useCapture.getState().texts[0].animation);
const history = () => page.evaluate(() => window.trackingControls.useCapture.getState().past.length);
const metadata = () => page.evaluate(() => window.trackingControls.useCapture.getState().texts[0].animationTracking);
const picker = page.locator("[data-tracking-point-picker]");
const choose = async (mobile = false) => {
  await page.getByRole("button", { name: mobile ? "✦ Follow…" : "✦ Follow something on the video…", exact: true }).click();
  await picker.waitFor();
  const box = await picker.boundingBox();
  await picker.click({ position: { x: box.width * .25, y: box.height * .4 } });
};
try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Blank project", exact: true }).click();
  await page.locator("[data-desktop-player]").waitFor();
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const sourceUrl = URL.createObjectURL(await (await fetch(`${location.origin}/tracking-fixture.mp4`)).blob());
    const clip = { id: 1, url: sourceUrl, color: "#000", srcDur: 2, in: 0, out: 2, speed: 1,
      zoom: 1, mirror: false, width: 720, height: 1280, fit: "contain" };
    const text = { id: 7, text: "Follow", color: 0, start: 0, end: 2, x: 50, y: 50 };
    useCapture.getState().patch({ screen: "editor", clips: [clip], texts: [text], selText: 7, sel: -1, t: 0, sheet: null, past: [], future: [] });
    window.trackingControls = { useCapture };
  });
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  await controls().waitFor();
  const before = await history();
  await choose();
  await page.locator("[data-tracked-keyframes]").waitFor();
  assert.equal(await history(), before + 1);
  assert(Math.abs(requests[0].target.x - .25) < .01 && Math.abs(requests[0].target.y - .4) < .01);
  assert(requests[0].frames.every(frame => frame.imageDataUrl.startsWith("data:image/jpeg;base64,")), "Actual decoder frames reach the API");
  assert.equal((await applied()).tracks.x.length, 3, "Two seconds produces endpoint keys and one key per second");
  assert.equal((await applied()).tracks.x[0].value, 0, "Following preserves initial layer separation");
  const requestCount = requests.length;
  await page.getByRole("button", { name: "A key every 0.5 seconds", exact: true }).click();
  assert.equal((await applied()).tracks.x.length, 5);
  await page.getByRole("button", { name: "A key every 2 seconds", exact: true }).click();
  assert.equal((await applied()).tracks.x.length, 2);
  assert.equal(requests.length, requestCount, "Density refits use cached measurements without GPU calls");
  const retained = await applied();
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  assert.equal(await metadata(), undefined);
  assert.deepEqual(await applied(), retained, "Detach retains editable motion");
  await page.evaluate(() => window.trackingControls.useCapture.getState().undo());
  assert.equal((await metadata()).step, 2, "Undo restores tracking provenance");
  await page.evaluate(() => { const state = window.trackingControls.useCapture; while (state.getState().past.length) state.getState().undo(); });
  assert.equal(await applied(), undefined);

  hold = true;
  await choose(); await waitPending();
  await page.evaluate(() => {
    const state = window.trackingControls.useCapture.getState();
    state.updateText(7, { text: "New draft" });
  });
  await release();
  await controls().getByRole("alert").filter({ hasText: "project changed" }).waitFor();
  assert.equal(await applied(), undefined, "Stale results never overwrite edits");

  await choose(); await waitPending();
  await controls().getByRole("button", { name: "Cancel", exact: true }).click();
  await release();
  assert.equal(await applied(), undefined, "A cancelled response cannot apply later");

  hold = false;
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(() => window.trackingControls.useCapture.getState().patch({ sheet: "animation", t: 0 }));
  await page.getByRole("button", { name: "✦ Follow…", exact: true }).click();
  await picker.waitFor();
  await mkdir("/tmp/pvo-keyframe-review", { recursive: true });
  await page.screenshot({ path: "/tmp/pvo-keyframe-review/tracking-mobile-pick.png" });
  await picker.press("ArrowRight"); await picker.press("Enter");
  await page.locator("[data-tracked-keyframes]").waitFor();
  const latest = requests.at(-1);
  assert(Math.abs(latest.target.x - .52) < .0001 && latest.target.y === .5, "Keyboard picking uses normalized canvas coordinates");
  await page.screenshot({ path: "/tmp/pvo-keyframe-review/tracking-mobile.png" });
  const beforeUnmount = await history();
  hold = true;
  await page.getByRole("button", { name: "Re-track object", exact: true }).click(); await waitPending();
  await page.evaluate(() => window.trackingControls.useCapture.getState().patch({ selText: null, sel: 0 }));
  await release();
  assert.equal(await history(), beforeUnmount, "Switching selection cancels the owned job");
  assert.equal(await page.evaluate(() => window.trackingControls.useCapture.getState().clips[0].animation), undefined);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, requests: requests.length, actualFrames: requests[0].frames.length,
    checks: ["desktop point picking", "real JPEG extraction", "readable key density", "cached refit", "detach/Undo", "stale result rejection", "cancellation", "mobile keyboard picking", "unmount cancellation"] }));
} catch (error) { console.error({ errors, body: (await page.locator("body").innerText()).slice(0, 5000) }); throw error; }
finally { if (pending) await release(); await browser.close(); }
