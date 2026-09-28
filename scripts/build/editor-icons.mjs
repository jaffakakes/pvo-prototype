import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const publicDir = resolve(root, "editor/public");
const mark = await readFile(resolve(publicDir, "restyle-mark.png"));
const imageUrl = `data:image/png;base64,${mark.toString("base64")}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  const page = await browser.newPage();
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const encoded = await page.evaluate(async ({ source, size }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      const mark = new Image();
      mark.src = source;
      await mark.decode();

      const square = size * .68;
      const origin = (size - square) / 2;
      const corner = size * .16;
      const shadow = size * .035;
      context.fillStyle = "#0B0B0F";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#FF5C8A";
      context.beginPath();
      context.roundRect(origin + shadow, origin + shadow, square, square, corner);
      context.fill();
      context.fillStyle = "#15151C";
      context.strokeStyle = "#000";
      context.lineWidth = size * .015;
      context.beginPath();
      context.roundRect(origin, origin, square, square, corner);
      context.fill();
      context.stroke();

      const markSize = size * .46;
      context.filter = "invert(1)";
      context.drawImage(mark, (size - markSize) / 2, (size - markSize) / 2, markSize, markSize);
      return canvas.toDataURL("image/png").split(",")[1];
    }, { source: imageUrl, size });
    await writeFile(resolve(publicDir, name), Buffer.from(encoded, "base64"));
  }
} finally {
  await browser.close();
}
