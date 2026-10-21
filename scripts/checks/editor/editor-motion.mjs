import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const artifacts = "/tmp/restyle-editor-motion";
await mkdir(artifacts, { recursive: true });
const errors = [];
async function fixture(page) {
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    window.motionStore = useCapture;
    const scene = {
      id: "main",
      name: "Main",
      parent: null,
      clips: [mkClip(8, null, 0)],
      texts: [],
      components: [],
      muted: true,
      sound: -1,
      layers: ["video"],
    };
    useCapture.getState().patch({
      scenes: [scene],
      currentSceneId: "main",
      clips: scene.clips,
      texts: [],
      components: [],
      audioClips: [],
      layers: scene.layers,
      screen: "editor",
      t: 1,
      sel: -1,
      selComp: null,
      selText: null,
      selAudio: null,
      sheet: null,
      playing: false,
      tryMode: null,
      past: [],
      future: [],
    });
    useCapture.getState().addComponent("choice");
    await document.fonts.ready;
  });
  await page.getByRole("toolbar", { name: "Choice tools" }).waitFor();
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}
async function settled(page) {
  await page.waitForFunction(
    () => !document.documentElement.dataset.editorMotion,
  );
}
try {
  for (const [width, height, theme] of [
    [393, 852, "light"],
    [430, 932, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "no-preference",
    });
    await context.addInitScript(() => {
      window.motionRecords = [];
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const transition = start(...args);
        void transition.ready.then(
          () => {
            window.motionRecords.push({
              subject: document.documentElement.dataset.editorMotion,
              reduced: document.documentElement.dataset.editorMotionReduced,
              animations: document.getAnimations().map((animation) => ({
                name: animation.animationName ?? "",
                duration: animation.effect?.getTiming().duration,
                frames: animation.effect?.getKeyframes(),
              })),
            });
          },
          () => {},
        );
        return transition;
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5191/", {
      waitUntil: "networkidle",
    });
    await fixture(page);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const tools = page.getByRole("toolbar", { name: "Choice tools" });
    const before = await page.locator(".pvBox").boundingBox();
    await tools.getByRole("button", { name: "Opacity", exact: true }).click();
    await page.getByRole("slider", { name: "Opacity" }).waitFor();
    await settled(page);
    const enlarged = await page.locator(".pvBox").boundingBox();
    assert(enlarged.height > before.height);
    const record = await page.evaluate(() => window.motionRecords.at(-1));
    assert.equal(record.subject, "tool");
    assert(
      record.animations.some((item) => item.name.includes("editor-video")),
      "Video visibly transitions to its larger frame",
    );
    const transitions = await page.evaluate(() => window.motionRecords.length);
    await page.getByRole("slider", { name: "Opacity" }).press("ArrowLeft");
    assert.equal(
      await page.evaluate(() => window.motionRecords.length),
      transitions,
      "Slider changes do not restart navigation",
    );
    assert.deepEqual(await page.locator(".pvBox").boundingBox(), enlarged);
    await page.screenshot({
      path: `${artifacts}/${width}-${theme}-opacity.png`,
    });
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .click();
    await tools.waitFor();
    await settled(page);
    assert.deepEqual(
      await page.locator(".pvBox").boundingBox(),
      before,
      "Closing restores the layout",
    );

    await tools.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator("[data-component-page]").waitFor();
    await settled(page);
    assert(
      (await page.evaluate(() => window.motionRecords.at(-1))).animations.some(
        (item) => item.name.includes("editor-component"),
      ),
      "Design carries the selected component into its stage",
    );
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await tools.waitFor();
    await settled(page);
    assert.equal(
      await page.evaluate(
        () => window.motionStore.getState().components[0].opacity,
      ),
      0.99,
    );
    await tools.getByRole("button", { name: "Timing", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose component start" });
    await picker.waitFor();
    await settled(page);
    assert(
      (await page.evaluate(() => window.motionRecords.at(-1))).animations.some(
        (item) => item.name.includes("editor-video"),
      ),
      "Timing shares the video expansion",
    );
    await page.screenshot({
      path: `${artifacts}/${width}-${theme}-timing.png`,
    });
    await page.keyboard.press("Escape");
    await tools.waitFor();
    await settled(page);

    // Closing during entry supersedes the visual without queuing another edit.
    await tools.getByRole("button", { name: "Opacity", exact: true }).click();
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .evaluate((button) => button.click());
    await tools.waitFor();
    await settled(page);
    assert.equal(
      await page.evaluate(() => window.motionStore.getState().sheet),
      null,
    );

    await page
      .getByRole("button", { name: "Project settings", exact: true })
      .click();
    const menu = page.getByRole("dialog", {
      name: "Project settings",
      exact: true,
    });
    const reduce = menu.getByRole("switch", {
      name: "Reduce motion",
      exact: true,
    });
    const advanced = menu.getByRole("switch", {
      name: "Advanced edits",
      exact: true,
    });
    assert((await reduce.boundingBox()).y > (await advanced.boundingBox()).y);
    await reduce.click();
    assert.equal(await reduce.getAttribute("aria-checked"), "true");
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("restyle.editor.reduceMotion"),
      ),
      "true",
    );
    await page.screenshot({
      path: `${artifacts}/${width}-${theme}-settings.png`,
    });
    await page.keyboard.press("Escape");
    await tools.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator("[data-component-page]").waitFor();
    await settled(page);
    const reduced = await page.evaluate(() => window.motionRecords.at(-1));
    assert.equal(reduced.reduced, "true");
    assert(
      !reduced.animations.some((item) =>
        /editor-(component|video|dock)/.test(item.name),
      ),
    );
    assert(
      reduced.animations.every((item) => item.duration <= 80),
      "Reduced motion uses a short fade",
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.locator(".app").getAttribute("data-reduce-motion"),
      "true",
    );
    await fixture(page);
    await page.evaluate(async () => {
      const { setReduceMotion } =
        await import("/src/state/preferences/editorPreferences.ts");
      setReduceMotion(false);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await tools.getByRole("button", { name: "Timing", exact: true }).click();
    await picker.waitFor();
    await settled(page);
    assert.equal(
      (await page.evaluate(() => window.motionRecords.at(-1))).reduced,
      "true",
      "System preference is respected too",
    );
    await page.keyboard.press("Escape");
    await tools.waitFor();
    await settled(page);
    // Browsers without View Transitions still complete the same commands.
    await page.evaluate(() => {
      document.startViewTransition = undefined;
    });
    await tools.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator("[data-component-page]").waitFor();
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await tools.waitFor();
    console.log(
      `${width} ${theme}: focus, reverse, live controls, interruption, preferences, reload and fallback passed`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
