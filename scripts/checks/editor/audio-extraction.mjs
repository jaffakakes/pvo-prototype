import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const directory = await mkdtemp(join(tmpdir(), "pvo-audio-check-"));
const input = join(directory, "tone.mp4");
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=blue:s=320x240:r=30:d=4",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=4",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  input,
]);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await context.addInitScript(() => {
  const NativeAudio = window.Audio;
  window.__testAudio = [];
  window.Audio = class extends NativeAudio {
    constructor(...args) {
      super(...args);
      window.__testAudio.push(this);
    }
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const audio = () => page.locator("[data-audio-id]");
async function store() {
  return page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const s = useCapture.getState();
    return {
      clips: s.clips,
      audioClips: s.audioClips,
      past: s.past.length,
      t: s.t,
    };
  });
}
async function drag(locator, dx, cancel = false) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, {
    steps: 8,
  });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
try {
  await page.goto(`${url}?home=1`);
  await page.getByLabel("Upload video files").setInputFiles(input);
  await page
    .getByRole("button", { name: "Start editing", exact: true })
    .click();
  await page.locator("[data-desktop-editor]").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".pvVideo")?.readyState >= 2,
  );
  assert.equal(await audio().count(), 0, "Import must keep audio attached");
  await page.getByRole("button", { name: /^Clip 1,/ }).click();
  await page
    .getByRole("button", { name: "Extract audio", exact: true })
    .click();
  await audio().waitFor();
  assert.equal((await store()).clips[0].audioDetached, true);
  await page.waitForFunction(
    () => document.querySelector(".pvVideo")?.muted === true,
  );
  await drag(audio(), 40);
  assert(Math.abs((await store()).audioClips[0].start - 1) < 0.01);
  const beforeCancel = (await store()).past;
  await drag(audio(), 24, true);
  assert.equal((await store()).past, beforeCancel);
  assert(Math.abs((await store()).audioClips[0].start - 1) < 0.01);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(350);
  assert(
    await page.evaluate(() =>
      window.__testAudio
        .filter((item) => item.src)
        .every((item) => item.paused),
    ),
    "Audio starts at its moved position",
  );
  await page.waitForFunction(() =>
    window.__testAudio.some(
      (item) => item.src && !item.paused && item.currentTime > 0.1,
    ),
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await audio().click();
  await drag(audio().locator('[data-edge="r"]'), -40);
  assert(Math.abs((await store()).audioClips[0].out - 3) < 0.01);
  await page.getByRole("button", { name: /^Undo/ }).click();
  assert.equal((await store()).audioClips[0].out, 4);

  await page.waitForFunction(async () => {
    const id = new URL(location.href).searchParams.get("project");
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("restyle-editor-project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise((resolve) => {
        const request = database
          .transaction("checkpoints")
          .objectStore("checkpoints")
          .get(`project:${id}`);
        request.onsuccess = () => resolve(request.result);
      });
      const audio = record?.project?.scenes?.[0]?.audioClips?.[0];
      return audio && Math.abs(audio.start - 1) < 0.01 && audio.out === 4;
    } finally {
      database.close();
    }
  });
  await page.reload();
  await audio().waitFor();
  assert(
    Math.abs((await store()).audioClips[0].start - 1) < 0.01,
    "Audio timing survives reopening",
  );
  assert.equal((await store()).clips[0].audioDetached, true);

  const encoded = await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const { exportVideo } =
      await import("/src/infrastructure/media/exportVideo.ts");
    const result = await exportVideo(useCapture.getState(), () => {});
    const buffer = new Uint8Array(await result.blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < buffer.length; offset += 16384)
      binary += String.fromCharCode(...buffer.subarray(offset, offset + 16384));
    URL.revokeObjectURL(result.url);
    return btoa(binary);
  });
  const output = join(directory, "extracted.webm");
  await writeFile(output, Buffer.from(encoded, "base64"));
  const pcm = execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    output,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  function rms(start, end) {
    let sum = 0,
      count = 0;
    for (
      let i = Math.floor(start * 8000);
      i < end * 8000 && i * 4 < pcm.length;
      i++
    ) {
      sum += pcm.readFloatLE(i * 4) ** 2;
      count++;
    }
    return Math.sqrt(sum / count);
  }
  assert(
    rms(0.2, 0.7) < 0.001,
    "Export must silence the original video's audio before the moved layer",
  );
  assert(
    rms(1.5, 2.5) > 0.02,
    "Export must contain extracted audio at its new position",
  );
  assert(
    rms(4.3, 4.7) > 0.02,
    "Extracted audio must continue past the video end",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await audio().waitFor();
  assert.equal(
    await page.locator(".audioTrack").count(),
    0,
    "No fake original-sound track",
  );
  await audio().click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(await audio().count(), 0);
  assert.equal(
    (await store()).clips[0].audioDetached,
    true,
    "Deleting audio must not re-enable original sound",
  );
  await page.keyboard.press("Control+z");
  await audio().waitFor();
  for (
    let step = 0;
    step < 10 && (await store()).clips[0].audioDetached;
    step++
  )
    await page.keyboard.press("Control+z");
  assert.equal(await audio().count(), 0);
  await page.locator(".tlClip").first().click();
  await page
    .getByRole("button", { name: "Extract audio", exact: true })
    .click();
  await audio().waitFor();
  await drag(audio(), 25);
  assert(
    Math.abs((await store()).audioClips[0].start - 0.5) < 0.01,
    "Mobile audio layer moves independently",
  );
  await page.screenshot({
    path: join(directory, "mobile-extracted-audio.png"),
  });
  assert.equal(errors.length, 0, errors.join("; "));
  console.log(
    `Audio extraction passed: opt-in extraction, independent timing, undo/cancel, preview, persistence, mobile extraction/drag/deletion, audible export and audio tail. Artifacts: ${directory}`,
  );
} finally {
  await browser.close();
}
