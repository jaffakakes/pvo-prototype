import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { packPvoProject, readPvoProject, PVO_SPEC_VERSION } from "../../../packages/pvo-sdk/index.js";

const playerUrl = process.env.PVO_PLAYER_URL || "http://127.0.0.1:4173/player/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sampleVideo = await readFile(new URL("../../../assets/pvo-demo.mp4", import.meta.url));
const continueAction = { type: "custom", name: "restyle_continue" };
const manifest = {
  spec_version: PVO_SPEC_VERSION,
  initial_scene: "main",
  canvas: { ratio: "9:16", width: 9, height: 16 },
  restyle_capture: { version: 1 },
  media: [
    { id: "media-main", asset_id: "asset-main", name: "media/main.mp4", type: "video/mp4" },
    { id: "media-branch", asset_id: "asset-branch", name: "media/branch.mp4", type: "video/mp4" },
    { id: "media-detail", asset_id: "asset-detail", name: "media/detail.mp4", type: "video/mp4" },
  ],
  scenes: [
    { id: "main", parent: null, label: "Main", asset_id: "asset-main", start: 0, end: 2 },
    { id: "branch", parent: "main", label: "Scene B", asset_id: "asset-branch", start: 0, end: 1.2 },
    { id: "detail", parent: "branch", label: "Scene i", asset_id: "asset-detail", start: 0, end: 1 },
  ],
  playback: {
    initial_timeline: "timeline-main",
    timelines: [
      { id: "timeline-main", kind: "main", clips: [{ id: "clip-main", scene: "main", asset_id: "asset-main", start: 0, end: 2 }] },
      { id: "timeline-branch", kind: "branch", clips: [{ id: "clip-branch", scene: "branch", asset_id: "asset-branch", start: 0, end: 1.2 }] },
      { id: "timeline-detail", kind: "branch", clips: [{ id: "clip-detail", scene: "detail", asset_id: "asset-detail", start: 0, end: 1 }] },
    ],
  },
  components: [
    {
      id: "choice-main", kind: "choice", title: "Choose a path",
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      presentation: { scene: "main", start: .35, end: .4, x: .015, y: .42, width: .71, height: .4 },
      options: [
        { label: "Open Scene B", action: { type: "goto_scene", scene: "branch" } },
        { label: "Continue", action: continueAction },
      ],
      restyle_capture: {
        version: 1, at: .35, dur: null, x: 37, y: 62,
        outcomes: [{ kind: "scene", sceneId: "branch" }, { kind: "continue" }],
      },
    },
    {
      id: "form-branch", kind: "form", title: "Leave a note",
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      presentation: { scene: "branch", start: .35, end: .4, x: .345, y: .23, width: .77, height: .38 },
      fields: [{ name: "name_0", label: "Name", type: "text", required: true }],
      submit_label: "Send", on_submit: { type: "goto_scene", scene: "detail" },
      restyle_capture: {
        version: 1, at: .35, dur: null, x: 73, y: 42,
        outcomes: [{ kind: "scene", sceneId: "detail" }],
        code: { language: {
          version: 1,
          structure: "components/form-branch/structure.pvo",
          style: "components/form-branch/style.pvo",
          logic: "components/form-branch/logic.pvo",
        } },
      },
    },
  ],
};

const packageBlob = await packPvoProject({
  manifest,
  assets: [
    { id: "asset-main", name: "media/main.mp4", blob: new Blob([sampleVideo], { type: "video/mp4" }) },
    { id: "asset-branch", name: "media/branch.mp4", blob: new Blob([sampleVideo], { type: "video/mp4" }) },
    { id: "asset-detail", name: "media/detail.mp4", blob: new Blob([sampleVideo], { type: "video/mp4" }) },
    ...Object.entries({
      structure: '<form><field name="name_0" kind="name"/><submit>Send</submit></form>',
      style: " ",
      logic: 'on submit { go_to_scene("detail"); }',
    }).map(([part, source]) => ({
      id: `components/form-branch/${part}.pvo`, name: `components/form-branch/${part}.pvo`,
      blob: new Blob([source], { type: "text/plain" }),
    })),
  ],
});
const decoded = await readPvoProject(packageBlob);
assert.equal(decoded.validation.valid, true, JSON.stringify(decoded.validation.errors));
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const browserErrors = [];
// The static demo has no favicon; Chrome requests one outside the player itself.
await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
page.on("pageerror", error => browserErrors.push(error.message));
page.on("console", message => { if (message.type() === "error") browserErrors.push(`${message.text()} (${message.location().url})`); });
page.on("response", response => { if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()} ${response.url()}`); });

async function assertPosition(left, top) {
  const position = page.locator(".capture-position");
  await position.waitFor({ state: "visible" });
  const actual = await position.evaluate(element => {
    const frame = document.querySelector("#playerFrame").getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      left: element.style.left,
      top: element.style.top,
      x: (box.left + box.width / 2 - frame.left) / frame.width * 100,
      y: (box.top + box.height / 2 - frame.top) / frame.height * 100,
    };
  });
  assert.equal(actual.left, `${left}%`);
  assert.equal(actual.top, `${top}%`);
  assert.ok(Math.abs(actual.x - left) < 1, `Overlay x did not use its authored center: ${JSON.stringify(actual)}`);
  assert.ok(Math.abs(actual.y - top) < 1, `Overlay y did not use its authored center: ${JSON.stringify(actual)}`);
}

try {
  const response = await page.goto(playerUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `Player did not load at ${playerUrl}`);
  await page.locator("#pvoInput").setInputFiles({
    name: "browser-smoke.pvo",
    mimeType: "application/vnd.pvo",
    buffer: Buffer.from(await packageBlob.arrayBuffer()),
  });
  await page.locator("#playerShell").waitFor({ state: "visible" });
  const choice = page.locator("pvo-component-view").filter({ hasText: "Choose a path" });
  await page.waitForTimeout(500);
  if (await choice.count() === 0 && await page.locator("#video").evaluate(video => video.paused)) {
    await page.locator("#playButton").click();
  }
  await choice.waitFor({ state: "visible", timeout: 10000 });
  await assertPosition(37, 62);
  assert.equal(await page.locator("#video").getAttribute("data-asset-id"), "asset-main");
  await choice.getByRole("button", { name: "Open Scene B" }).click();
  await page.locator('#video[data-asset-id="asset-branch"]').waitFor({ timeout: 10000 });

  const form = page.locator(".code-position iframe").first().contentFrame();
  await form.getByRole("textbox", { name: "Name" }).waitFor({ state: "visible", timeout: 10000 });
  await assertPosition(73, 42);
  await form.getByRole("textbox", { name: "Name" }).fill("Ada");
  await form.getByRole("button", { name: "Send" }).click();
  await page.locator('#video[data-asset-id="asset-detail"]').waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#timelineLabel").textContent(), "Scene i");
  await page.locator("#endScreen").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator("#video").getAttribute("data-asset-id"), "asset-detail",
    "An explicit scene outcome must end on its selected timeline without an implicit return.");
  assert.deepEqual(browserErrors, [], "Player emitted browser errors");
  assert.equal(await page.locator("#status.error.is-visible").count(), 0, "Player displayed an error");
  console.log("PVO player smoke passed: paused answers, Choice → Scene B → Form → Scene i, explicit terminal routing, authored centers, zero errors.");
} catch (error) {
  console.error(`PVO player smoke failed: ${error.message}`);
  console.error(`Player status: ${await page.locator("#status").textContent().catch(() => "unavailable")}`);
  console.error(`Video: ${JSON.stringify(await page.locator("#video").evaluate(video => ({ paused: video.paused, time: video.currentTime, readyState: video.readyState, asset: video.dataset.assetId })).catch(() => ({})))}`);
  console.error(`Browser errors: ${browserErrors.join("; ") || "none"}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
