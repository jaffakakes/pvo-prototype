import { resolve } from "node:path";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = resolve("share/assets/preview.mp4");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

async function watchPlayback(page) {
  await page.evaluate(() => {
    const video = document.querySelector(".pvVideo");
    window.__playbackCheck = { events: [], frameTimes: [], watching: true, startedAt: performance.now() };
    for (const type of ["seeking", "seeked", "waiting", "playing"]) {
      video.addEventListener(type, () => {
        window.__playbackCheck.events.push({ type, ms: performance.now() - window.__playbackCheck.startedAt });
      });
    }
    const frame = (now, metadata) => {
      if (!window.__playbackCheck.watching) return;
      window.__playbackCheck.frameTimes.push({ ms: now, mediaTime: metadata.mediaTime });
      video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".strip");
    const transform = getComputedStyle(strip).transform;
    return {
      mediaTime: document.querySelector(".pvVideo").currentTime,
      stripLeft: transform === "none" ? Number.parseFloat(strip.style.left) : new DOMMatrixReadOnly(transform).m41,
      clipTag: document.querySelector(".pvTag")?.textContent?.trim() ?? "",
      paused: document.querySelector(".pvVideo").paused,
    };
  });
}

async function plainVideoFrames() {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  try {
    await page.setContent('<input type="file"><video playsinline style="width:300px;height:400px"></video><button>Play baseline</button>');
    await page.locator('input[type="file"]').setInputFiles(videoFile);
    await page.evaluate(async () => {
      const video = document.querySelector("video");
      video.src = URL.createObjectURL(document.querySelector("input").files[0]);
      await new Promise(resolve => video.addEventListener("loadeddata", resolve, { once: true }));
      window.__plainPlayback = { frames: [], events: [], startedAt: performance.now() };
      video.addEventListener("playing", () => {
        window.__plainPlayback.events.push({ type: "playing", ms: performance.now() - window.__plainPlayback.startedAt });
      });
      const frame = (now, metadata) => {
        window.__plainPlayback.frames.push({ ms: now, mediaTime: metadata.mediaTime });
        if (window.__plainPlayback.frames.length < 200) video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
      document.querySelector("button").addEventListener("click", () => { void video.play(); });
    });
    await page.getByRole("button", { name: "Play baseline" }).click();
    await page.waitForTimeout(3500);
    return await page.evaluate(() => ({
      ...window.__plainPlayback,
      endedAt: performance.now(),
      mediaTime: document.querySelector("video").currentTime,
    }));
  } finally {
    await page.close();
  }
}

function playbackStats(frames, events, startedAt, endedAt, mediaTime) {
  const firstPlayingMs = events.find(event => event.type === "playing")?.ms ?? null;
  const firstProgressFrame = frames.find(frame => frame.mediaTime > .05);
  const activeSeconds = firstProgressFrame ? (endedAt - firstProgressFrame.ms) / 1000 : 0;
  const activeFrames = firstProgressFrame ? frames.filter(frame => frame.ms >= firstProgressFrame.ms).length : 0;
  return {
    mediaTime: Number(mediaTime.toFixed(2)),
    firstPlayingMs: firstPlayingMs == null ? null : Math.round(firstPlayingMs),
    firstProgressMs: firstProgressFrame ? Math.round(firstProgressFrame.ms - startedAt) : null,
    activeSeconds: Number(activeSeconds.toFixed(2)),
    frames: frames.length,
    activeFps: activeSeconds ? Math.round(activeFrames / activeSeconds) : 0,
  };
}

try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor" }).waitFor();
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.waitForFunction(() => document.querySelector(".pvVideo")?.readyState >= 2);

  const before = await snapshot(page);
  await watchPlayback(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(3500);
  const natural = await page.evaluate(() => {
    window.__playbackCheck.watching = false;
    window.__playbackCheck.endedAt = performance.now();
    return window.__playbackCheck;
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const after = await snapshot(page);
  const lateInterruptions = natural.events.filter(event =>
    event.ms > 200 && (event.type === "seeking" || event.type === "waiting"));
  if (after.mediaTime < 2 || before.stripLeft - after.stripLeft < 95) {
    throw new Error(`The media and fixed-playhead timeline did not advance together: ${JSON.stringify({ before, after })}`);
  }
  if (lateInterruptions.length) {
    throw new Error(`Uninterrupted playback sought or waited mid-clip: ${JSON.stringify(lateInterruptions)}`);
  }

  await page.waitForFunction(() => !document.querySelector(".pvVideo").seeking);
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__playbackCheck.events.length = 0; });
  const timeline = await page.locator(".tl").boundingBox();
  if (!timeline) throw new Error("Timeline is missing");
  const scrubPixels = Math.min(110, Math.max(40, Math.round((after.mediaTime - .7) * 50)));
  const x = timeline.x + Math.min(210, timeline.width / 2);
  const y = timeline.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + scrubPixels, y);
  await page.mouse.up();
  await page.waitForFunction(({ previousTime, minDrop }) => {
    const video = document.querySelector(".pvVideo");
    return !video.seeking && video.currentTime < previousTime - minDrop;
  }, { previousTime: after.mediaTime, minDrop: scrubPixels / 50 - .2 });
  const scrubbed = await snapshot(page);
  const scrubEvents = await page.evaluate(() => window.__playbackCheck.events.filter(event => event.type === "seeking"));
  if (scrubbed.stripLeft - after.stripLeft < scrubPixels - 20 || scrubEvents.length !== 1) {
    throw new Error(`A deliberate scrub should reposition the timeline and seek once: ${JSON.stringify({ after, scrubbed, scrubEvents })}`);
  }

  await page.keyboard.press("s");
  await page.waitForFunction(() => document.querySelectorAll(".tlClip").length === 2);
  await page.getByRole("button", { name: "Back to camera" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.waitForFunction(() => document.querySelector(".pvVideo")?.readyState >= 2);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".pvTag")?.textContent?.includes("Clip 2"), null, { timeout: 4000 });
  await page.waitForTimeout(350);
  const transitioned = await snapshot(page);
  if (transitioned.paused || transitioned.mediaTime < scrubbed.mediaTime + .2) {
    throw new Error(`Playback stalled at a split-clip transition: ${JSON.stringify({ scrubbed, transitioned })}`);
  }

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.close();
  const plain = await plainVideoFrames();
  console.log(JSON.stringify({
    naturalPlayback: {
      editor: playbackStats(natural.frameTimes, natural.events, natural.startedAt, natural.endedAt, after.mediaTime),
      plainUnmutedLater: playbackStats(plain.frames, plain.events, plain.startedAt, plain.endedAt, plain.mediaTime),
      seeks: natural.events.filter(event => event.type === "seeking").length,
      waits: natural.events.filter(event => event.type === "waiting").length,
      note: "The plain-video comparison runs second; browser startup and media cache can affect first-frame time.",
    },
    scrub: { seeks: scrubEvents.length, seconds: scrubbed.mediaTime },
    splitTransition: transitioned.clipTag,
  }, null, 2));
} finally {
  await browser.close();
}
