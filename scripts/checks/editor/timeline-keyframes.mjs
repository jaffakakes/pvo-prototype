import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output =
  process.env.PVO_TRAY_SCREENSHOTS ||
  resolve(tmpdir(), "restyle-timeline-keyframes");
await mkdir(output, { recursive: true });
const media = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
).replaceAll("\\", "/");
async function assertCropFrameFollowsVideo(page) {
  const aligned = await page.evaluate(() => {
    const video = document.querySelector(".videoLayer");
    const frame = document.querySelector("[data-crop-frame]");
    if (!video || !frame) return false;
    const videoBounds = video.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    return (
      getComputedStyle(video).transform === getComputedStyle(frame).transform &&
      ["x", "y", "width", "height"].every(
        (key) => Math.abs(videoBounds[key] - frameBounds[key]) < 0.1,
      )
    );
  });
  assert(
    aligned,
    "The grid and corners follow the video's position, scale and rotation",
  );
}

const browser = await launchBrowser({
  headless: true,
});
const errors = [];
try {
  for (const [width, height, theme] of [
    [393, 852, "light"],
    [393, 852, "dark"],
    [320, 568, "light"],
    [1280, 800, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 1024,
      isMobile: width < 1024,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/");
    await page.evaluate(
      async ({ media, theme, desktop }) => {
        const { useCapture } = await import("/src/state/captureStore.ts");
        const { initial } = await import("/src/state/project/initial.ts");
        const { setThemeMode } =
          await import("/src/state/preferences/themePreferences.ts");
        useCapture.setState(initial());
        setThemeMode(theme);
        const url = URL.createObjectURL(
          await (await fetch(`/@fs/${media}`)).blob(),
        );
        useCapture.getState().patch({
          screen: "editor",
          sel: 0,
          t: 0,
          clips: [
            {
              id: 1,
              url: desktop ? null : url,
              color: "#4d4257",
              srcDur: desktop ? 30 : 7.9,
              in: desktop ? 0 : 1,
              out: desktop ? 30 : 7,
              speed: desktop ? 1 : 2,
              zoom: 1,
              mirror: false,
              width: 720,
              height: 1280,
              fit: "cover",
            },
          ],
        });
        window.timelineCheck = { useCapture };
        await document.fonts.ready;
      },
      { media, theme, desktop: width >= 1024 },
    );
    await page.locator("#restyle-launch-splash").waitFor({ state: "hidden" });
    const settle = () =>
      page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
    await settle();
    const controls = page.getByRole("toolbar", {
      name: "Keyframe controls",
      exact: true,
    });
    const graphsButton = controls.getByRole("button", {
      name: "Graphs",
      exact: true,
    });
    const desktop = width >= 1024;
    assert.equal(
      await graphsButton.count(),
      0,
      "The curve control waits for a selected keyframe",
    );
    assert.equal(
      await controls.innerText(),
      "",
      "Scene controls are icon-only",
    );
    assert.equal(
      await controls.evaluate(
        (element) =>
          element.closest('nav[aria-label="Scenes"]') !== null &&
          element.nextElementSibling?.getAttribute("aria-label") ===
            "Show the whole scene tree",
      ),
      true,
      "Keyframe and curve controls sit immediately beside the scene tree",
    );
    const position = await controls.boundingBox();
    const ruler = await page.locator("[data-timeline-ruler]").boundingBox();
    const firstTrack = await page
      .locator("[data-timeline-ruler]")
      .evaluate((element) => {
        const bounds = element.nextElementSibling.getBoundingClientRect();
        return { y: bounds.y, height: bounds.height };
      });
    assert(
      position.y + position.height <= ruler.y + 1,
      "The scene controls stay above the ruler",
    );
    assert(
      firstTrack.y >= ruler.y + ruler.height - 1 &&
        firstTrack.y - ruler.y - ruler.height <= 8,
      "Tracks follow the ruler without a reserved animation toolbar row",
    );
    const add = controls.getByRole("button", {
      name: "Add keyframe",
      exact: true,
    });
    const addBox = await add.boundingBox();
    assert.equal(addBox.width, 30);
    assert.equal(addBox.height, 30);
    await page.evaluate(() =>
      window.timelineCheck.useCapture.getState().patch({ sel: -1 }),
    );
    assert.equal(
      await controls.count(),
      0,
      "No selected layer means no keyframe controls",
    );
    await page.evaluate(() =>
      window.timelineCheck.useCapture.getState().patch({ sel: 0 }),
    );
    if (!desktop) {
      await page.evaluate(() => {
        window.timelineCheck.useCapture.getState().patch({
          texts: Array.from({ length: 12 }, (_, id) => ({
            id: id + 10,
            text: "Layer",
            start: 0,
            end: 2,
            x: 50,
            y: 50,
            color: 0,
          })),
        });
      });
      await page.locator(".tl").evaluate((element) => {
        element.scrollTop = 100;
      });
      const scrolled = await controls.boundingBox();
      assert(
        Math.abs(scrolled.y - position.y) < 1,
        "Controls stay fixed while the layer list scrolls vertically",
      );
      await page.evaluate(() =>
        window.timelineCheck.useCapture.getState().patch({ texts: [] }),
      );
      await page.locator(".tl").evaluate((element) => {
        element.scrollTop = 0;
      });
    }
    if (desktop) {
      await page.locator("[data-desktop-editor]").waitFor();
      assert.equal(
        await page
          .getByRole("toolbar", { name: "Timeline editing" })
          .getByRole("button", { name: /Add keyframe/ })
          .count(),
        0,
        "The old toolbar icon is removed",
      );
      await add.click();
      assert.equal(await graphsButton.count(), 1);
      const graphBox = await graphsButton.boundingBox();
      assert.equal(graphBox.width, 30);
      assert.equal(graphBox.height, 30);
      await graphsButton.click();
      await page.getByRole("region", { name: "Graphs", exact: true }).waitFor();
      await graphsButton.click();
      const beforeScroll = await controls.boundingBox();
      await page.evaluate(() => {
        const content = document.querySelector(
          "[data-desktop-timeline] [data-desktop-playhead]",
        ).parentElement;
        content.parentElement.scrollLeft = 120;
      });
      const afterScroll = await controls.boundingBox();
      assert(
        Math.abs(afterScroll.x - beforeScroll.x) < 1 &&
          Math.abs(afterScroll.y - beforeScroll.y) < 1,
        "The controls stay fixed while desktop content scrolls",
      );
      await settle();
      await page.screenshot({ path: resolve(output, "graphs-desktop.png") });
      await context.close();
      continue;
    }
    if (width === 320) {
      await add.click();
      assert.equal(await graphsButton.count(), 1);
      await graphsButton.click();
      const curves = page.getByRole("region", { name: "Graphs", exact: true });
      await curves.waitFor();
      await settle();
      assert.equal(await curves.getByRole("button").count(), 4);
      await page.screenshot({
        path: resolve(output, `graphs-${width}-${theme}.png`),
      });
      await context.close();
      console.log(
        "320×568: contextual keyframe and curve controls stay usable beside the assistant.",
      );
      continue;
    }
    const playhead = page.getByRole("slider", {
      name: "Timeline playhead",
      exact: true,
    });
    const snapshot = () =>
      page.evaluate(() => {
        const state = window.timelineCheck.useCapture.getState();
        return {
          clip: JSON.parse(JSON.stringify(state.clips[0])),
          past: state.past.length,
          time: state.t,
          sheet: state.sheet,
          playing: state.playing,
        };
      });
    const markers = page.locator("[data-keyframe-point]");
    const before = await snapshot();
    const header = await controls.boundingBox();
    const strip = await page.locator(".tlClips").boundingBox();
    assert(
      header.y + header.height <= strip.y + 1,
      "The diamond and graph sit above the movie strip",
    );
    for (const button of await controls.getByRole("button").all()) {
      const box = await button.boundingBox();
      assert(
        box.width === 30 && box.height === 30,
        "Each scene icon button is 30 px",
      );
    }
    await controls
      .getByRole("button", { name: "Add keyframe", exact: true })
      .click();
    let current = await snapshot();
    assert.equal(current.past, before.past + 1);
    assert.equal(current.sheet, null, "Adding a keyframe opens no tab");
    assert.equal(await markers.count(), 1);
    assert(
      Object.values(current.clip.animation.tracks).every(
        (keys) => keys[0].time === 1,
      ),
      "Trimmed video captures source seconds",
    );
    assert(
      await page
        .getByRole("group", { name: "Transform video", exact: true })
        .isVisible(),
      "The new point can be transformed directly on the picture",
    );
    await playhead.press("End");
    const afterSeek = await controls.boundingBox();
    assert(
      Math.abs(afterSeek.y - position.y) < 1 &&
        Math.abs(afterSeek.x + afterSeek.width - position.x - position.width) <
          1,
      "Controls stay anchored while the strip scrolls",
    );
    assert.equal(
      await graphsButton.count(),
      0,
      "Moving off the selected point hides its curve control",
    );
    await controls
      .getByRole("button", { name: "Add keyframe", exact: true })
      .click();
    assert.equal(await markers.count(), 2);
    const surface = page.getByRole("group", {
      name: "Transform video",
      exact: true,
    });
    const box = await surface.boundingBox();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await context.newCDPSession(page);
    const points = (progress) =>
      [0, 1].map((id) => {
        const distance = 12 * (1 + 0.2 * progress) * (id ? 1 : -1);
        const angle = (20 * progress * Math.PI) / 180;
        return {
          id,
          x: center.x + distance * Math.cos(angle),
          y: center.y + distance * Math.sin(angle),
        };
      });
    const historyBeforeTouch = (await snapshot()).past;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(0),
    });
    for (let step = 1; step <= 10; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(step / 10),
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    current = await snapshot();
    assert.equal(
      current.past,
      historyBeforeTouch + 1,
      "A keyframe pinch/twist is one Undo",
    );
    assert(
      Math.abs(current.clip.animation.tracks.scaleX.at(-1).value - 1.2) < 0.01,
    );
    assert(
      Math.abs(current.clip.animation.tracks.rotation.at(-1).value - 20) < 0.1,
    );
    await assertCropFrameFollowsVideo(page);
    const beforeGraphs = current.past;
    await markers.last().click();
    await graphsButton.click();
    const graphs = page.getByRole("region", { name: "Graphs", exact: true });
    await graphs.waitFor();
    await settle();
    assert.equal(
      (await snapshot()).past,
      beforeGraphs,
      "Graphs opens without adding a point or history",
    );
    assert(
      await page.locator(".tl").isVisible(),
      "Graphs retains the movie timeline",
    );
    assert.equal(
      await page
        .locator(".tl")
        .evaluate((element) => !!element.closest("[inert]")),
      false,
    );
    assert.equal(
      await graphs.getByRole("button").count(),
      4,
      "Only the four easing choices remain",
    );
    assert.equal(await graphs.getByRole("slider").count(), 0);
    assert.equal(
      await graphs
        .getByRole("group", { name: "Position pad", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator("[data-animation-ribbon], [data-animation-sheet]")
        .count(),
      0,
    );
    assert((await graphs.boundingBox()).height <= 102, "Graphs stays compact");
    assert.equal(
      await graphs
        .getByRole("button", { name: "Speed up", exact: true })
        .isEnabled(),
      false,
      "The last point has no outgoing segment",
    );
    await playhead.press("Home");
    await playhead.press("ArrowRight");
    await assertCropFrameFollowsVideo(page);
    const beforeSelect = (await snapshot()).past;
    await page
      .getByRole("button", { name: "Keyframe at 0:00.0", exact: true })
      .click();
    assert.equal(
      (await snapshot()).time,
      0,
      "Tapping a strip diamond seeks to the exact point",
    );
    assert.equal(
      (await snapshot()).past,
      beforeSelect,
      "Selecting a point does not create history",
    );
    await graphs.getByRole("button", { name: "Speed up", exact: true }).click();
    current = await snapshot();
    for (const keys of Object.values(current.clip.animation.tracks))
      assert.equal(keys[0].easing, "ease-in");
    assert.equal(
      current.past,
      beforeGraphs + 1,
      "Changing the curve is one Undo",
    );
    const playback = page.getByRole("toolbar", {
      name: "Playback controls",
      exact: true,
    });
    await playback.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.timelineCheck.useCapture.getState().playing &&
        window.timelineCheck.useCapture.getState().t > 0.15,
    );
    await playback.getByRole("button", { name: "Pause", exact: true }).click();
    assert.equal(
      (await snapshot()).past,
      beforeGraphs + 1,
      "Previewing does not edit the curve",
    );
    await playhead.press("Home");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(
      (await snapshot()).clip.animation.tracks.x[0].easing,
      "linear",
    );
    await assertCropFrameFollowsVideo(page);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await controls
      .getByRole("button", { name: "Remove keyframe", exact: true })
      .click();
    assert.equal(
      await markers.count(),
      1,
      "Tapping a filled diamond removes that point",
    );
    assert.equal(
      await graphsButton.count(),
      0,
      "Removing the selected key hides its curve control",
    );
    // Select the remaining point to regain its contextual curve toggle.
    await markers.first().click();
    await graphsButton.click();
    assert.equal((await snapshot()).sheet, null);
    await playhead.press("Home");
    const beforeSpace = (await snapshot()).past;
    await controls
      .getByRole("button", { name: "Add keyframe", exact: true })
      .press("Space");
    assert.equal((await snapshot()).past, beforeSpace + 1);
    assert.equal(
      (await snapshot()).playing,
      false,
      "Space activates the diamond without starting playback",
    );
    await graphsButton.click();
    await graphs.getByRole("button", { name: "Speed up", exact: true }).click();
    await settle();
    assert.equal(
      await page
        .locator(".tools")
        .getByRole("button", { name: "Keyframes", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await graphs.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: resolve(output, `graphs-${width}-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await graphs.waitFor({ state: "hidden" });
    await context.close();
    console.log(
      `${width}×${height}, ${theme}: timeline keyframe/graph controls, source clocks, gestures, Undo/Redo, curves, keyboard and compact layout passed.`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
