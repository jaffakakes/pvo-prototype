import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(10000);

async function state() {
  return page.evaluate(async () => {
    const current = (await import("/src/store.ts")).useCapture.getState();
    return {
      clip: current.clips[0],
      text: current.texts[0],
      past: current.past.length,
      t: current.t,
      sound: current.sound,
    };
  });
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const clip = mkClip(10, null, 0);
    useCapture
      .getState()
      .patch({
        clips: [clip],
        screen: "editor",
        sel: 0,
        t: 8,
        past: [],
        future: [],
      });
  });
  await page.getByRole("button", { name: "Speed", exact: true }).click();
  const speed = page.getByRole("dialog", { name: "Speed", exact: true });
  await speed.getByRole("button", { name: "2x", exact: true }).click();
  assert.equal((await state()).clip.speed, 2);
  assert.equal((await state()).t, 5);
  await speed.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Crop", exact: true }).click();
  const crop = page.getByRole("dialog", { name: "Crop", exact: true });
  const beforeCrop = (await state()).past;
  await crop.getByRole("slider").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  assert.equal((await state()).clip.zoom, 1.02);
  assert.equal((await state()).past, beforeCrop + 1);
  await crop.getByRole("button", { name: "Mirror", exact: true }).click();
  assert.equal((await state()).clip.mirror, true);
  await crop.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Collapse clip tools", exact: true })
    .click();

  await page.getByRole("button", { name: "Sound", exact: true }).click();
  const sound = page.getByRole("dialog", { name: "Sound", exact: true });
  await sound.getByRole("button", { name: /Night Drive/ }).click();
  assert.equal((await state()).sound, 2);
  await sound.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".audioTrack")?.textContent?.includes("Night Drive"),
  );

  await page.evaluate(async () =>
    (await import("/src/store.ts")).useCapture.getState().patch({ t: 2 }),
  );
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const text = page.getByRole("dialog", { name: "Add text", exact: true });
  await text
    .getByRole("textbox", { name: "Text content" })
    .fill("Keep this caption");
  await text.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  const editText = page.getByRole("dialog", { name: "Edit text", exact: true });
  await editText.getByRole("tab", { name: "Timing", exact: true }).click();
  await editText
    .getByRole("spinbutton", { name: "Text start", exact: true })
    .fill("1");
  assert.equal((await state()).text.start, 1);
  await editText.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".textOverlay").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  console.log(
    "Clip adjustments passed: speed/playhead, grouped crop history, mirror, shared sound label and text timing.",
  );
} finally {
  await browser.close();
}
