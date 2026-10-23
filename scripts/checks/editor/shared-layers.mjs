import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const output =
  process.env.PVO_LAYER_ARTIFACTS || join(tmpdir(), "restyle-shared-layers");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const errors = [];

async function fixture(page, theme) {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/");
  await page.evaluate(async (theme) => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { mkClip } = await import("/src/state/editing/clipFactory.ts");
    const { setThemeMode } =
      await import("/src/state/preferences/themePreferences.ts");
    useCapture.setState(initial());
    setThemeMode(theme);
    useCapture.getState().patch({
      screen: "editor",
      clips: [mkClip(6, null, 0)],
      texts: [
        { id: 10, text: "Title", start: 0, end: 2, color: 0, x: 50, y: 50 },
      ],
      components: [],
      audioClips: [
        {
          id: 20,
          name: "Sound effect",
          url: null,
          srcDur: 3,
          in: 0,
          out: 2,
          start: 1,
          speed: 1,
          muted: false,
        },
      ],
      music: { track: 1, start: 1, duration: 2, offset: 0.5, gain: 1 },
      layers: ["music", "audio:20", "video", "text:10"],
      past: [],
      future: [],
    });
    window.sharedLayerStore = useCapture;
  }, theme);
  await page.getByRole("button", { name: "Add keyframe", exact: true }).count();
  await page.waitForFunction(() =>
    document.querySelector('[data-layer-id="music"]'),
  );
  await page.locator("#restyle-launch-splash").waitFor({ state: "hidden" });
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.sharedLayerStore.getState();
    return {
      order: s.layers,
      start: s.music?.start,
      duration: s.music?.duration,
      offset: s.music?.offset,
      audioStart: s.audioClips[0]?.start,
      past: s.past.length,
      future: s.future.length,
    };
  });

async function drag(page, context, locator, dx, dy, touch, cancel = false) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = Math.max(
    145,
    Math.min(box.x + box.width / 2, page.viewportSize().width - 24),
  );
  const y = box.y + box.height / 2;
  if (touch) {
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let n = 1; n <= 8; n++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (dx * n) / 8, y: y + (dy * n) / 8, id: 1 }],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
    } finally {
      await cdp.detach();
    }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  }
}

try {
  for (const [width, height, theme] of [
    [390, 844, "light"],
    [320, 568, "dark"],
    [1280, 800, "light"],
  ]) {
    const touch = width < 1024;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: touch,
      isMobile: touch,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await fixture(page, theme);
      const music = page.locator(
        'button[data-layer-id="music"][data-layer-type="music"]',
      );
      const audio = page.locator('button[data-audio-id="20"]');
      const scale = touch ? 50 : 40;
      const before = await state(page);
      await drag(page, context, music, scale, 0, touch);
      const moved = await state(page);
      assert(
        Math.abs(moved.start - before.start - 1) < 0.03,
        `Music moves in time at ${width}px: ${JSON.stringify(moved)}`,
      );
      assert.equal(moved.offset, before.offset);
      assert.equal(
        moved.past,
        before.past + 1,
        "A complete move creates one Undo",
      );
      await page.evaluate(() => window.sharedLayerStore.getState().undo());
      assert.equal((await state(page)).start, before.start);
      const beforeCancel = await state(page);
      await drag(page, context, music, scale, 0, touch, true);
      assert.deepEqual(
        await state(page),
        beforeCancel,
        "Cancellation restores timing and the redo branch",
      );

      const label = page.getByRole("button", { name: /^Select music layer:/ });
      await label.scrollIntoViewIfNeeded();
      await label.press("Alt+ArrowUp");
      const firstOrder = (await state(page)).order;
      assert.deepEqual(firstOrder, ["audio:20", "music", "video", "text:10"]);
      await label.press("Alt+ArrowUp");
      assert.deepEqual((await state(page)).order, [
        "audio:20",
        "video",
        "music",
        "text:10",
      ]);
      const visual = await page.evaluate(async () =>
        (await import("/src/domain/layers/order.ts")).visualLayerOrder(
          window.sharedLayerStore.getState(),
        ),
      );
      assert.deepEqual(
        visual,
        ["video", "text:10"],
        "Audio ordering must not change compositing",
      );

      const audioBefore = await state(page);
      await drag(page, context, audio, scale, 0, touch);
      assert(
        Math.abs((await state(page)).audioStart - audioBefore.audioStart - 1) <
          0.03,
        "Sound moves through the shared timing command",
      );
      const reorderBefore = await state(page);
      await drag(page, context, music, 0, 55, touch);
      assert.notDeepEqual(
        (await state(page)).order,
        reorderBefore.order,
        "Music reorders by dragging its block vertically",
      );
      assert.equal((await state(page)).start, reorderBefore.start);
      await page.evaluate(() => window.sharedLayerStore.getState().undo());
      assert.deepEqual((await state(page)).order, reorderBefore.order);

      await label.scrollIntoViewIfNeeded();
      await label.press("Alt+ArrowDown");
      await page.screenshot({
        path: join(output, `shared-layers-${width}-${theme}.png`),
      });
      assert.deepEqual(errors, []);
      console.log(
        `${width}px: typed audio/music rows, real ${touch ? "touch" : "mouse"} moves, vertical reorder, cancellation, history and visual stacking passed.`,
      );
    } finally {
      await context.close();
    }
  }

  // Inspect the actual encoded audio: silence before/after the authored music interval.
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await fixture(page, "light");
    const bytes = await page.evaluate(async () => {
      const { exportVideo } =
        await import("/src/infrastructure/media/exportVideo.ts");
      const s = window.sharedLayerStore.getState();
      const result = await exportVideo(
        {
          ...s.scenes[0],
          muted: true,
          texts: [],
          components: [],
          audioClips: [],
          music: { track: 1, start: 2, duration: 2, offset: 1, gain: 1 },
          ratio: "1:1",
          quality: "720p",
        },
        () => {},
      );
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      URL.revokeObjectURL(result.url);
      return btoa(binary);
    });
    const path = join(output, "timed-music.webm");
    await writeFile(path, Buffer.from(bytes, "base64"));
    const pcm = execFileSync(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const rms = (start, end) => {
      let sum = 0,
        count = 0;
      for (
        let i = Math.floor(start * 8000);
        i < Math.min(pcm.length / 4, end * 8000);
        i++
      ) {
        sum += pcm.readFloatLE(i * 4) ** 2;
        count++;
      }
      assert(count > 0);
      return Math.sqrt(sum / count);
    };
    assert(rms(0.3, 1.4) < 0.002, "Export must be silent before music starts");
    assert(rms(2.4, 3.2) > 0.01, "The authored music interval must be audible");
    assert(rms(4.7, 5.5) < 0.002, "Export must be silent after music ends");
    console.log(
      "Actual music export passed: authored start/end and source offset are encoded into the mix.",
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
