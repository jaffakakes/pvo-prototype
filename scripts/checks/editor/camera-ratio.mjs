import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const cases = [
  { ratio: "9:16", width: 720, height: 1280, fillsPortrait: true },
  { ratio: "1:1", width: 720, height: 720, fillsPortrait: false },
  { ratio: "4:5", width: 720, height: 900, fillsPortrait: true },
  { ratio: "16:9", width: 1280, height: 720, fillsPortrait: false },
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream"] });
try {
  for (const expected of cases) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"], acceptDownloads: true });
    try {
      await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
      await page.waitForFunction(() => (document.querySelector(".live")?.videoWidth ?? 0) > 0);
      await page.getByRole("button", { name: "Ratio" }).click();
      await page.getByRole("menuitemradio", { name: expected.ratio }).click();
      await page.waitForFunction(({ width, height, ratio, fillsPortrait }) => {
        const frame = document.querySelector(".cameraFrame");
        const viewfinder = document.querySelector(".viewfinder");
        if (!frame || !viewfinder || frame.dataset.ratio !== ratio || frame.dataset.fill !== String(fillsPortrait)) return false;
        return fillsPortrait
          ? Math.abs(frame.clientWidth - viewfinder.clientWidth) < 2 && Math.abs(frame.clientHeight - viewfinder.clientHeight) < 2
          : Math.abs(frame.clientWidth / frame.clientHeight - width / height) < .02;
      }, expected);
      if (expected.ratio === "9:16") await page.screenshot({ path: resolve(tmpdir(), "capture-ratio-portrait.png") });
      if (expected.ratio === "1:1") await page.screenshot({ path: resolve(tmpdir(), "capture-ratio-square.png") });
      if (expected.ratio === "16:9") await page.screenshot({ path: resolve(tmpdir(), "capture-ratio-wide.png") });
      await page.getByRole("button", { name: "Record" }).click();
      await page.waitForTimeout(1100);
      await page.getByRole("button", { name: "Stop recording" }).click();
      await page.getByRole("button", { name: "Open editor" }).click();
      const preview = await page.locator(".pvVideo").evaluate(video => ({ fit: getComputedStyle(video).objectFit, width: video.parentElement.clientWidth, height: video.parentElement.clientHeight }));
      if (preview.fit !== "cover" || Math.abs(preview.width / preview.height - expected.width / expected.height) > .03) throw new Error(`${expected.ratio} preview mismatch: ${JSON.stringify(preview)}`);
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Export video" }).click();
      const dimensions = await page.getByRole("link", { name: "Download", timeout: 15000 }).evaluate(async link => {
        const video = document.createElement("video");
        video.src = link.href;
        return await new Promise((resolve, reject) => { video.onloadedmetadata = () => resolve([video.videoWidth, video.videoHeight]); video.onerror = reject; });
      });
      if (dimensions[0] !== expected.width || dimensions[1] !== expected.height) throw new Error(`${expected.ratio} export mismatch: ${dimensions}`);
      console.log(`${expected.ratio}: camera frame, preview, ${dimensions.join("×")} export passed`);
    } finally {
      await page.close();
    }
  }
  const landscape = await browser.newPage({ viewport: { width: 844, height: 390 }, permissions: ["camera", "microphone"] });
  try {
    await landscape.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
    await landscape.waitForFunction(() => (document.querySelector(".live")?.videoWidth ?? 0) > 0);
    await landscape.getByRole("button", { name: "Ratio" }).click();
    await landscape.getByRole("menuitemradio", { name: "16:9" }).click();
    await landscape.waitForFunction(() => {
      const frame = document.querySelector(".cameraFrame");
      const viewfinder = document.querySelector(".viewfinder");
      const app = document.querySelector(".app");
      return app?.clientWidth >= 800 && frame?.dataset.fill === "true" && Math.abs(frame.clientWidth - viewfinder.clientWidth) < 2 && Math.abs(frame.clientHeight - viewfinder.clientHeight) < 2;
    });
    await landscape.waitForTimeout(500);
    await landscape.screenshot({ path: resolve(tmpdir(), "capture-ratio-landscape.png") });
    console.log("16:9 fills a landscape screen");
  } finally {
    await landscape.close();
  }
} finally {
  await browser.close();
}
