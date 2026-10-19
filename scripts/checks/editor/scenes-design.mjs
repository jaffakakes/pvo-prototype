import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
const url = process.env.EDITOR_URL || "http://127.0.0.1:5298/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const videoFile = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
try {
  for (const [width, height, theme, touch] of [
    [393, 852, "light", false],
    [393, 852, "dark", false],
    [320, 568, "light", true],
    [844, 390, "light", true],
  ]) {
    if (
      process.env.SCENES_TEST_WIDTH &&
      width !== Number(process.env.SCENES_TEST_WIDTH)
    )
      continue;
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      hasTouch: touch,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').setInputFiles(videoFile);
      await page
        .getByRole("button", { name: "Open editor", exact: true })
        .click();
      await page.evaluate(async () => {
        const { useCapture } = await import("/src/store.ts");
        const { createDefaultComponent } =
          await import("/src/domain/components/editing.ts");
        const state = useCapture.getState();
        const main = state.scenes[0];
        const make = (id, name, parent, clips = []) => ({
          ...main,
          id,
          name,
          parent,
          clips,
          components: [],
          texts: [],
          audioClips: [],
        });
        const a = make(
          "a",
          "Scene A",
          "main",
          main.clips.map((clip) => ({ ...clip, id: clip.id + 100, out: 4 })),
        );
        const i = make("i", "Scene i", "a"),
          ii = make("ii", "Scene ii", "a"),
          deep = make("deep", "Scene 1", "i");
        const rootChoice = createDefaultComponent(
          "root-choice",
          "choice",
          main,
          0,
        );
        rootChoice.fields.options = [
          { label: "Buy the set", outcome: { kind: "scene", sceneId: "a" } },
          { label: "Continue", outcome: { kind: "continue" } },
        ];
        const aChoice = createDefaultComponent("a-choice", "choice", a, 0);
        aChoice.fields.options = [
          { label: "Show me", outcome: { kind: "scene", sceneId: "i" } },
          { label: "Not now", outcome: { kind: "scene", sceneId: "ii" } },
        ];
        main.components = [rootChoice];
        a.components = [aChoice];
        state.edit({
          scenes: [main, a, i, ii, deep],
          currentSceneId: "a",
          sheet: null,
          selComp: null,
          sel: -1,
        });
      });
      await page.waitForTimeout(400);
      const areas = async () =>
        page.evaluate(() =>
          Object.fromEntries(
            [
              ".previewArea",
              "[data-assistant-playback]",
              ".scenesRow",
              ".toolBar",
            ].map((selector) => {
              const r = document
                .querySelector(selector)
                .getBoundingClientRect();
              return [
                selector,
                { x: r.x, y: r.y, width: r.width, height: r.height },
              ];
            }),
          ),
        );
      const before = await areas();
      const toggle = page.getByRole("button", {
        name: "Show the whole scene tree",
        exact: true,
      });
      await toggle.click();
      const tree = page.getByRole("region", {
        name: "Scene tree",
        exact: true,
      });
      await tree.waitFor();
      assert.deepEqual(
        await areas(),
        before,
        "Panel must not move any surrounding region",
      );
      assert.equal(
        await tree
          .getByRole("radio", { name: "Tree", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      assert.equal(
        await tree.locator('[data-scene-id][aria-current="true"]').count(),
        1,
      );
      assert.match(
        await tree.locator('[data-scene-id="a"]').innerText(),
        /Choice: Buy the set/,
      );
      assert.match(
        await tree.locator('[data-scene-id="i"]').innerText(),
        /No content yet/,
      );
      await tree.locator('[data-scene-id="main"]').focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.sceneId),
        "a",
      );
      if (process.env.PVO_EDITOR_ARTIFACTS)
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/scenes-tree-${width}-${theme}.png`,
        });
      await tree.getByRole("radio", { name: "Map", exact: true }).click();
      assert.equal(
        await tree.locator("[data-map-scene]").count(),
        4,
        "One hop excludes grandchildren",
      );
      assert.match(await tree.innerText(), /\+1 more/);
      await tree
        .getByRole("button", { name: "Centre on Scene i", exact: true })
        .click();
      await tree.locator('[data-map-scene="i"][aria-current="true"]').waitFor();
      assert.equal(
        await tree.isVisible(),
        true,
        "Map stays open when recentering",
      );
      await tree
        .getByRole("button", { name: "Centre on Scene A", exact: true })
        .click();
      await tree.locator('[data-map-scene="a"][aria-current="true"]').waitFor();
      if (process.env.PVO_EDITOR_ARTIFACTS)
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/scenes-map-${width}-${theme}.png`,
        });
      await tree
        .getByRole("button", { name: "Fit all scenes", exact: true })
        .click();
      assert.equal(await tree.locator("[data-map-scene]").count(), 5);
      await tree.getByRole("button", { name: "Zoom in", exact: true }).click();
      assert.equal(
        await tree.locator("[data-scene-map]").getAttribute("data-fit"),
        "false",
      );
      const canvas = tree.getByRole("group", { name: "Scene connections" });
      const transform = await canvas.getAttribute("style");
      await tree.evaluate((element) => {
        element.scrollTop = 0;
      });
      const start = await tree.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        for (
          let y = Math.max(0, bounds.top);
          y < Math.min(innerHeight, bounds.bottom);
          y += 2
        ) {
          const x = bounds.x + bounds.width / 2;
          const hit = document.elementFromPoint(x, y);
          if (
            hit?.closest("[data-scene-map]") &&
            !hit.closest('[aria-label="Map zoom"]')
          )
            return { x, y: y + 2 };
        }
        return null;
      });
      assert(start, "Map has a reachable pan surface");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 35, start.y, { steps: 4 });
      await page.mouse.up();
      assert.notEqual(
        await canvas.getAttribute("style"),
        transform,
        "Map pans",
      );
      if (width === 320) {
        const client = await context.newCDPSession(page);
        const beforePinch = await canvas.getAttribute("style");
        const pinchY = await tree.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const x = bounds.x + bounds.width / 2;
          for (let y = bounds.top + 10; y < bounds.bottom - 10; y += 4) {
            if (
              [-32, 32].every((offset) =>
                document
                  .elementFromPoint(x + offset, y)
                  ?.closest("[data-scene-map]"),
              )
            )
              return y;
          }
          return null;
        });
        assert(pinchY, "Map has room for two touch points");
        const touches = (offset) => [
          { x: start.x - offset, y: pinchY, id: 1 },
          { x: start.x + offset, y: pinchY, id: 2 },
        ];
        await client.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: touches(16),
        });
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: touches(24),
        });
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: touches(32),
        });
        await client.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await page.waitForTimeout(250);
        assert.notEqual(
          await canvas.getAttribute("style"),
          beforePinch,
          "Two-finger pinch changes the map zoom",
        );
        await client.detach();
      }
      await tree
        .getByRole("button", { name: "Close scene tree", exact: true })
        .press("Escape");
      await tree.waitFor({ state: "hidden" });
      await toggle.click();
      assert.equal(
        await tree
          .getByRole("radio", { name: "Map", exact: true })
          .getAttribute("aria-checked"),
        "true",
        "View preference persists",
      );
      await tree.getByRole("radio", { name: "Tree", exact: true }).click();
      await tree
        .getByRole("button", { name: "Add a branch to Scene A", exact: true })
        .click();
      await tree.waitFor({ state: "hidden" });
      const state = await page.evaluate(async () => {
        const { useCapture } = await import("/src/store.ts");
        const s = useCapture.getState();
        return {
          count: s.scenes.length,
          id: s.currentSceneId,
          source: s.scenes.find((s) => s.id === "a").components.length,
        };
      });
      assert.equal(state.count, 6);
      assert.equal(state.source, 2);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(
        await page.evaluate(async () => {
          const { useCapture } = await import("/src/store.ts");
          return useCapture.getState().scenes.length;
        }),
        5,
      );
      assert.deepEqual(errors, []);
      console.log(
        `${width}x${height} ${theme}: stable region, routes, tree navigation, map centre/pan/fit, preference and atomic branch passed`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
