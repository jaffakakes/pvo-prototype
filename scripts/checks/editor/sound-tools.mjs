import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const url = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.log(message.text());
});
const current = () =>
  page.evaluate(async () => {
    const s = (
      await import("/src/state/captureStore.ts")
    ).useCapture.getState();
    return {
      audio: s.audioClips,
      past: s.past.length,
      sound: s.sound,
      t: s.t,
      sheet: s.sheet,
    };
  });
const soundMenu = async () => {
  const collapse = page.getByRole("button", { name: /^Collapse .* tools$/ });
  if (await collapse.count()) await collapse.click();
  await page.getByRole("button", { name: "Sound", exact: true }).click();
};
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    useCapture.getState().patch({
      clips: [mkClip(10, null, 0)],
      screen: "editor",
      sound: 0,
      t: 2.5,
      sel: -1,
      past: [],
      future: [],
    });
    window.voiceTracks = [];
    window.micRequests = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.micRequests.push(constraints);
      const audio = new AudioContext();
      const source = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      const track = destination.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop();
        source.stop();
        void audio.close();
      };
      window.voiceTracks.push(track);
      return destination.stream;
    };
  });
  await soundMenu();
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), [
    "Add sound",
    "Sound effect",
    "Voiceover",
  ]);
  await page.getByRole("menuitem", { name: "Add sound", exact: true }).click();
  const music = page.getByRole("dialog", { name: "Add sound", exact: true });
  await music.getByRole("button", { name: /Night Drive/ }).click();
  assert.equal((await current()).sound, 2);
  await music.getByRole("button", { name: "Close", exact: true }).click();
  await soundMenu();
  assert.equal(
    await page.getByRole("menuitem", { name: "Replace", exact: true }).count(),
    1,
  );
  await page
    .getByRole("menuitem", { name: "Sound effect", exact: true })
    .click();
  const effects = page.getByRole("dialog", {
    name: "Sound effects",
    exact: true,
  });
  const before = await current();
  await effects
    .getByRole("button", { name: "Preview Pop", exact: true })
    .click();
  assert.equal(
    (await current()).past,
    before.past,
    "Previewing must not edit the project",
  );
  assert.equal(
    await effects.evaluate((el) => getComputedStyle(el).borderRadius),
    "0px",
  );
  assert.equal(
    await effects.evaluate(
      (el) => getComputedStyle(el.closest("[data-active]")).borderRadius,
    ),
    "0px",
  );
  await effects.getByRole("button", { name: "Add Pop", exact: true }).click();
  let state = await current();
  assert.equal(state.audio[0].start, 2.5);
  assert.equal(state.audio[0].name, "Pop");
  assert.equal(state.past, before.past + 1);
  const portable = await page.evaluate(async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(
      bytes,
    );
    return {
      seconds: audio.duration,
      peak: Math.max(...audio.getChannelData(0)),
    };
  }, state.audio[0].url);
  assert(Math.abs(portable.seconds - 0.24) < 0.001 && portable.peak > 0.1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await current()).audio.length, 0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal((await current()).audio.length, 1);
  await soundMenu();
  await page.getByRole("menuitem", { name: "Voiceover", exact: true }).click();
  const voice = page.getByRole("group", { name: "Voiceover", exact: true });
  assert.equal(
    await page.locator(".tl").isVisible(),
    true,
    "Voiceover keeps the timeline visible",
  );
  assert.equal(
    await page.evaluate(() => window.micRequests.length),
    0,
    "Opening voiceover does not request microphone access",
  );
  await voice
    .getByRole("button", { name: "Reduce noise", exact: true })
    .click();
  await voice
    .getByRole("button", { name: "Record voiceover", exact: true })
    .click();
  await voice
    .getByRole("button", { name: "Stop voiceover", exact: true })
    .waitFor();
  await page.waitForTimeout(600);
  await voice
    .getByRole("button", { name: "Stop voiceover", exact: true })
    .click();
  await page.getByRole("button", { name: /^Voiceover, / }).waitFor();
  state = await current();
  assert.equal(state.audio.length, 2, JSON.stringify(state));
  assert.equal(state.audio[1].name, "Voiceover");
  assert.equal(state.audio[1].start, 2.5);
  assert(state.audio[1].srcDur >= 0.4);
  assert.equal(
    await page.evaluate(() => window.micRequests[0].audio.noiseSuppression),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      window.voiceTracks.every((track) => track.readyState === "ended"),
    ),
    true,
  );
  await voice.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await current()).audio.length, 1);
  await soundMenu();
  await page.getByRole("menuitem", { name: "Voiceover", exact: true }).click();
  await voice
    .getByRole("button", { name: "Record voiceover", exact: true })
    .click();
  await voice
    .getByRole("button", { name: "Stop voiceover", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    window.voiceTracks.every((track) => track.readyState === "ended"),
  );
  assert.equal(
    (await current()).audio.length,
    1,
    "Cancelled recordings are discarded",
  );
  await page.evaluate(() => {
    window.originalDecoder = OfflineAudioContext;
    window.OfflineAudioContext = class extends window.originalDecoder {
      decodeAudioData() {
        return Promise.reject(new Error("Test decode failure"));
      }
    };
  });
  await soundMenu();
  await page.getByRole("menuitem", { name: "Voiceover", exact: true }).click();
  await voice
    .getByRole("button", { name: "Record voiceover", exact: true })
    .click();
  await voice
    .getByRole("button", { name: "Stop voiceover", exact: true })
    .waitFor();
  await page.waitForTimeout(500);
  await voice
    .getByRole("button", { name: "Stop voiceover", exact: true })
    .click();
  await voice
    .getByRole("button", { name: "Retry saving", exact: true })
    .waitFor();
  assert.equal(
    (await current()).audio.length,
    1,
    "A failed recording is not inserted as blank audio",
  );
  await voice.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => {
    window.OfflineAudioContext = window.originalDecoder;
  });
  await soundMenu();
  await page.getByRole("menuitem", { name: "Voiceover", exact: true }).click();
  await voice
    .getByRole("button", { name: "Retry saving", exact: true })
    .click();
  await page.getByRole("button", { name: /^Voiceover, / }).waitFor();
  assert.equal(
    (await current()).audio.length,
    2,
    "Reopening and retrying saves the retained recording",
  );
  await voice.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Test denial", "NotAllowedError");
    };
  });
  await soundMenu();
  await page.getByRole("menuitem", { name: "Voiceover", exact: true }).click();
  await voice
    .getByRole("button", { name: "Record voiceover", exact: true })
    .click();
  await page.getByText("Microphone access denied.", { exact: true }).waitFor();
  assert.equal((await current()).audio.length, 1);
  await voice.getByRole("button", { name: "Done", exact: true }).click();
  for (const [width, height] of [
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await soundMenu();
    const bounds = await page
      .getByRole("menu", { name: "Sound", exact: true })
      .boundingBox();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y + bounds.height <= height,
    );
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Sound tools passed: contextual menu, music, real SFX, undo/redo, voiceover recording, noise constraints, microphone cleanup and responsive bounds.",
  );
} finally {
  await context.close();
  await browser.close();
}
