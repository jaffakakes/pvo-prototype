import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const chromePath =
  process.env.CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(10_000);

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const text = {
      id: 17,
      text: "Overlay-only scene",
      color: 0,
      start: 0,
      end: 5,
      x: 50,
      y: 50,
    };
    const component = {
      id: "overlay-note",
      type: "tooltip",
      sceneId: "main",
      at: 1,
      dur: 4,
      x: 50,
      y: 75,
      fields: { text: "No video required" },
    };
    const scene = {
      id: "main",
      name: "Main",
      parent: null,
      clips: [],
      audioClips: [],
      texts: [text],
      components: [component],
      muted: false,
      sound: 0,
      layers: ["text:17", "component:overlay-note", "video"],
    };
    useCapture.getState().patch({
      scenes: [scene],
      currentSceneId: "main",
      clips: [],
      audioClips: [],
      texts: [text],
      components: [component],
      layers: scene.layers,
      screen: "editor",
      sel: -1,
      selComp: null,
      selText: null,
      selAudio: null,
      sheet: null,
      t: 0,
      playing: false,
      tryMode: null,
      past: [],
      future: [],
    });
  });

  const timeline = page.locator(".tl");
  await timeline.locator(".textBar").waitFor();
  assert.equal(await timeline.locator('.compBar[data-layer-id="component:overlay-note"]').count(), 1);
  assert.equal(await timeline.locator(".tlClip").count(), 0);
  assert.equal(await timeline.getByRole("button", { name: "Add clip", exact: true }).count(), 1);

  const playhead = timeline.getByRole("slider", {
    name: "Timeline playhead",
    exact: true,
  });
  assert.equal(await playhead.getAttribute("aria-valuemax"), "5");
  assert.equal(await playhead.isEnabled(), true);
  await playhead.focus();
  await page.keyboard.press("End");
  assert.equal(await playhead.getAttribute("aria-valuenow"), "5");

  const header = page.locator(".editorHead");
  assert.equal(
    await header.locator("p").innerText(),
    "Main · 0:05 · no clips yet",
  );
  const tryButton = header.getByRole("button", { name: "Try", exact: true });
  assert.equal(await tryButton.isEnabled(), true);

  await page.locator("body").focus();
  await page.keyboard.press("t");
  await header.getByRole("button", { name: "Stop", exact: true }).waitFor();
  await page.keyboard.press("t");
  await tryButton.waitFor();

  assert.deepEqual(errors, [], "Overlay-only editing should have no page errors");
  console.log(
    "PASS: mobile keeps an overlay-only timeline editable and enables playhead and Try keyboard controls.",
  );
} finally {
  await context.close();
  await browser.close();
}
