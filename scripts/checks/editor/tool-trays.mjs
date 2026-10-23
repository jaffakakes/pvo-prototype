import { launchBrowser } from "../helpers/browser.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const output =
  process.env.PVO_TRAY_SCREENSHOTS || resolve(tmpdir(), "restyle-tool-trays");
await mkdir(output, { recursive: true });
const browser = await launchBrowser({
  headless: true,
});
const media = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
).replaceAll("\\", "/");
const failures = [];
async function assertEditorPalette(page, theme) {
  const result = await page.evaluate(() => {
    const accents = ["rgb(197, 28, 92)", "rgb(255, 45, 120)"];
    const styles = getComputedStyle(document.documentElement);
    const strong = getComputedStyle(document.querySelector(".app")).color;
    const leaks = [];
    for (const node of document.querySelectorAll(".app *")) {
      if (!node.getClientRects().length) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      const time = node.closest(
        '.playhead, [data-desktop-playhead], [class*="_currentTime_"], [class*="_time_"], [class*="_playhead_"], [data-timeline-animation-controls] button:first-child[aria-pressed="true"]',
      );
      if (time) continue;
      for (const pseudo of [null, "::before", "::after"]) {
        const paint = getComputedStyle(node, pseudo);
        if (pseudo && ["none", "normal"].includes(paint.content)) continue;
        if (
          [
            "color",
            "backgroundColor",
            "borderColor",
            "outlineColor",
            "boxShadow",
          ].some((key) => accents.some((accent) => paint[key].includes(accent)))
        ) {
          leaks.push(
            `${node.tagName}.${node.className.baseVal ?? node.className}${pseudo || ""}`,
          );
        }
      }
    }
    const sliders = [
      ...document.querySelectorAll('[data-tool-tray] [role="slider"]'),
    ].map((node) => ({
      fill: getComputedStyle(node.firstElementChild).backgroundColor,
      knob: getComputedStyle(node.lastElementChild).backgroundColor,
      border: getComputedStyle(node.lastElementChild).borderColor,
    }));
    const diamond = document.querySelector(
      "[data-timeline-animation-controls] button",
    );
    const selectedClip = document.querySelector(
      '.tlClip[data-sel="true"], [data-desktop-timeline] button[data-selected="true"]',
    );
    return {
      accent: styles.getPropertyValue("--accent").trim().toLowerCase(),
      strong,
      leaks,
      sliders,
      diamond: diamond && {
        color: getComputedStyle(diamond).color,
        on: diamond.getAttribute("aria-pressed") === "true",
      },
      clipShadow: selectedClip && getComputedStyle(selectedClip).boxShadow,
    };
  });
  assert.equal(result.accent, "#c51c5c");
  assert.equal(
    result.strong,
    theme === "light" ? "rgb(36, 29, 37)" : "rgb(255, 253, 251)",
  );
  assert.deepEqual(
    result.leaks,
    [],
    "Magenta is reserved for the playhead, its time and the on-keyframe diamond",
  );
  for (const slider of result.sliders) {
    assert.equal(slider.fill, result.strong);
    assert.equal(slider.border, result.strong);
    assert.equal(
      slider.knob,
      theme === "light" ? "rgb(255, 253, 251)" : "rgb(47, 39, 49)",
    );
    assert.notEqual(
      slider.fill,
      slider.knob,
      "The knob remains visible on the slider fill",
    );
  }
  if (result.diamond)
    assert.equal(
      result.diamond.color,
      result.diamond.on ? "rgb(197, 28, 92)" : result.strong,
    );
  if (result.clipShadow)
    assert(
      result.clipShadow.includes(`${result.strong} 3px 3px 0px`),
      "Selected clips use a hard neutral shadow",
    );
}
const settle = (page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
try {
  for (const [width, height, theme] of [
    [393, 852, "light"],
    [393, 852, "dark"],
    [320, 568, "light"],
    [1280, 800, "light"],
    [1280, 800, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 1024,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await installAssistantAvailabilityFixture(context);
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(
      async ({ media, theme }) => {
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
          sheet: null,
          t: 0,
          clips: [
            {
              id: 1,
              url,
              color: "#ff2d78",
              srcDur: 4,
              in: 0,
              out: 4,
              speed: 1,
              zoom: 1,
              mirror: false,
              width: 720,
              height: 1280,
              fit: "cover",
            },
          ],
          texts: [
            {
              id: 7,
              text: "A new perspective",
              color: 0,
              start: 0,
              end: 4,
              x: 50,
              y: 40,
            },
          ],
        });
        window.trayCheck = { useCapture };
        await document.fonts.ready;
      },
      { media, theme },
    );
    if (width >= 1024) {
      await page.locator("[data-desktop-editor]").waitFor();
      await page.locator("#restyle-launch-splash").waitFor({ state: "hidden" });
      assert.equal(
        await page.locator("[data-tool-tray]").count(),
        0,
        "Phone trays do not replace the desktop inspector",
      );
      await assertEditorPalette(page, theme);
      await page.screenshot({ path: resolve(output, `desktop-${theme}.png`) });
      await context.close();
      continue;
    }
    const timeline = page.locator(".tl");
    await page.locator("[data-assistant-region]").waitFor();
    const frame = page.locator(".pvBox");
    await timeline.waitFor();
    await settle(page);
    await page.waitForFunction(
      () =>
        document.querySelector(".pvBox")?.getBoundingClientRect().height > 150,
    );
    const initialHeight = (await frame.boundingBox()).height;
    const tools = page.locator(".tools");
    assert.equal(
      await tools.getByRole("button", { name: "Animate", exact: true }).count(),
      0,
    );
    for (const name of ["Speed", "Crop", "Volume"]) {
      await tools.getByRole("button", { name, exact: true }).click();
      const tray = page.locator(`[data-tool-tray="${name.toLowerCase()}"]`);
      await tray.waitFor();
      await settle(page);
      await assertEditorPalette(page, theme);
      assert(await timeline.isVisible(), `${name}: timeline remains visible`);
      assert.equal(
        await timeline.evaluate((element) => !!element.closest("[inert]")),
        false,
        `${name}: timeline remains interactive`,
      );
      const box = await tray.boundingBox();
      assert.equal(
        await page.locator(".toolBar").count(),
        0,
        `${name}: the edit toolbar is replaced by the open tray`,
      );
      assert(
        await tray.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        `${name}: focus moves into the tray when the toolbar is hidden`,
      );
      assert.equal(
        await tray.getByRole("button", { name: /^(Close|Collapse)/ }).count(),
        0,
        `${name}: no extra close control is added inside the tray`,
      );
      const collapseButton = page.getByRole("button", {
        name: "Close tool",
        exact: true,
      });
      const collapseVisible = await collapseButton.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return (
          box.x >= 0 &&
          box.right <= innerWidth &&
          (hit === button || button.contains(hit))
        );
      });
      assert(
        collapseVisible,
        `${name}: the existing preview close control is visible and tappable`,
      );
      const track = await page.locator(".sceneTimeline").boundingBox();
      const movie = await page.locator(".tlClip").first().boundingBox();
      const timelineBox = await timeline.boundingBox();
      assert(
        movie.y >= timelineBox.y &&
          movie.y + movie.height <= timelineBox.y + timelineBox.height + 1,
        `${name}: the full movie strip fits above the tray`,
      );
      const player = await frame.boundingBox();
      await page.screenshot({
        path: resolve(
          output,
          `${width}-${theme}-${name.toLowerCase()}-layout.png`,
        ),
      });
      assert(
        box.y >= track.y + track.height - 1,
        `${name}: tray follows timeline`,
      );
      assert(
        player.height < initialHeight,
        `${name}: preview makes room for the tray (${initialHeight} → ${player.height})`,
      );
      assert(
        Math.abs(player.width / player.height - 9 / 16) < 0.02,
        `${name}: preview retains its ratio`,
      );
      assert(
        box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height,
        `${name}: tray fits the phone`,
      );
      const overflow = await tray.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      );
      assert.equal(overflow, false, `${name}: no horizontal overflow`);
      if (name === "Speed") {
        await tray.getByRole("button", { name: "1.5×", exact: true }).click();
        assert.equal(
          await page.evaluate(
            () => window.trayCheck.useCapture.getState().clips[0].speed,
          ),
          1.5,
        );
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        assert.equal(
          await page.evaluate(
            () => window.trayCheck.useCapture.getState().clips[0].speed,
          ),
          1,
        );
      }
      if (name === "Crop") {
        assert(box.height <= 194, `Crop stays compact (${box.height}px)`);
        assert.equal(
          await tray
            .getByRole("slider", { name: "Scale", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await tray
            .getByRole("slider", { name: "Rotate", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await tray.locator('input[type="range"]').count(),
          0,
          "The old Zoom slider is removed",
        );
        assert(
          await tray
            .getByRole("group", { name: "Position pad", exact: true })
            .isVisible(),
        );
        await tray
          .getByRole("slider", { name: "Opacity", exact: true })
          .press("ArrowLeft");
        assert.equal(
          await page.evaluate(
            () =>
              window.trayCheck.useCapture.getState().clips[0].animation.tracks
                .opacity[0].value,
          ),
          0.99,
        );
        await tray.getByRole("button", { name: "Mirror", exact: true }).click();
        assert.equal(
          await page.evaluate(
            () => window.trayCheck.useCapture.getState().clips[0].mirror,
          ),
          true,
        );
        await tray.getByRole("button", { name: "Reset", exact: true }).click();
      }
      if (name === "Volume") {
        await tray
          .getByRole("slider", { name: "Volume", exact: true })
          .press("ArrowLeft");
        assert.equal(
          await page.evaluate(
            () =>
              window.trayCheck.useCapture.getState().clips[0].animation.tracks
                .gain[0].value,
          ),
          0.99,
        );
      }
      await assertEditorPalette(page, theme);
      await page.screenshot({
        path: resolve(output, `${width}-${theme}-${name.toLowerCase()}.png`),
      });
      if (name === "Crop" || name === "Volume") {
        // Reset removes the animation. Create a point before opening its curve.
        const addKey = page.getByRole("button", {
          name: "Add keyframe",
          exact: true,
        });
        if (await addKey.isVisible()) await addKey.click();
        const graph = page
          .getByRole("toolbar", { name: "Keyframe controls", exact: true })
          .getByRole("button", { name: "Graphs", exact: true });
        await graph.click();
        const curves = page.getByRole("region", {
          name: "Graphs",
          exact: true,
        });
        await curves.waitFor();
        assert(
          await timeline.isVisible(),
          "Graphs keeps the movie strip visible",
        );
        assert.equal(await curves.getByRole("button").count(), 4);
        assert.equal(await curves.getByRole("slider").count(), 0);
        await graph.click();
        await tools.getByRole("button", { name, exact: true }).click();
        await tray.waitFor();
      }
      await page
        .getByRole("button", { name: "Close tool", exact: true })
        .click();
      await tray.waitFor({ state: "hidden" });
      // Reuse the preview close control while the edit toolbar is hidden.
      await tools.getByRole("button", { name, exact: true }).click();
      await tray.waitFor();
      await settle(page);
      if (name === "Volume") {
        await page.evaluate(async () => {
          const { setAssistantThreadOpen } =
            await import("/src/state/assistant/threadStore.ts");
          setAssistantThreadOpen(true);
        });
        await settle(page);
        assert.equal(
          await tray.isVisible(),
          false,
          "The tray hides with the timeline and toolbar during conversation",
        );
        assert.equal(
          await tools
            .getByRole("button", { name: "Collapse clip tools", exact: true })
            .isVisible(),
          false,
        );
        await page.evaluate(async () => {
          const { setAssistantThreadOpen } =
            await import("/src/state/assistant/threadStore.ts");
          setAssistantThreadOpen(false);
        });
        await settle(page);
        await tray.waitFor();
      }
      const expandedDock = await page.locator(".editorDock").boundingBox();
      const beforeCollapse = await page.evaluate(() => {
        const state = window.trayCheck.useCapture.getState();
        return {
          past: state.past.length,
          clip: JSON.stringify(state.clips[0]),
        };
      });
      await page.getByRole("button", { name: "Close tool", exact: true }).tap();
      await tools.getByRole("button", { name: "Split", exact: true }).waitFor();
      await settle(page);
      assert.equal(
        await page.locator("[data-tool-tray]").count(),
        0,
        `${name}: the preview close control closes the tray`,
      );
      const collapsed = await page.evaluate(() => {
        const state = window.trayCheck.useCapture.getState();
        return {
          sheet: state.sheet,
          sel: state.sel,
          past: state.past.length,
          clip: JSON.stringify(state.clips[0]),
        };
      });
      assert.deepEqual(
        collapsed,
        { ...beforeCollapse, sheet: null, sel: 0 },
        `${name}: closing restores clip tools without changing edits, selection or Undo`,
      );
      assert(
        (await page.locator(".editorDock").boundingBox()).height <
          expandedDock.height,
        `${name}: the dock releases the tray's space`,
      );
    }
    for (const name of ["Crop", "Volume"]) {
      await tools.getByRole("button", { name, exact: true }).click();
      await page
        .getByRole("toolbar", { name: "Keyframe controls", exact: true })
        .getByRole("button", { name: "Graphs", exact: true })
        .click();
      await page.getByRole("region", { name: "Graphs", exact: true }).waitFor();
      assert.equal(
        await page.locator(".toolBar").count(),
        0,
        "Graphs also replaces the edit toolbar",
      );
      await page.getByRole("button", { name: "Close tool", exact: true }).tap();
      await tools.getByRole("button", { name: "Split", exact: true }).waitFor();
      assert.equal(
        await page.locator("[data-tool-tray]").count(),
        0,
        `${name} Graphs closes through the existing preview control`,
      );
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await tools.getByRole("button", { name: "Speed", exact: true }).click();
    assert.equal(
      await page
        .locator(".editorWorkspace")
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      "0s",
    );
    await page.keyboard.press("Escape");
    await page.locator('[data-tool-tray="speed"]').waitFor({ state: "hidden" });
    if (width === 393 && theme === "light") {
      const cdp = await context.newCDPSession(page);
      for (const edge of [
        { name: "landscape", width: 852, height: 393, inset: 0, font: "" },
        {
          name: "large-text-safe-area",
          width: 393,
          height: 700,
          inset: 34,
          font: "24px",
        },
        {
          name: "reduced-viewport",
          width: 393,
          height: 440,
          inset: 0,
          font: "",
        },
      ]) {
        await page.setViewportSize({ width: edge.width, height: edge.height });
        await cdp.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 0, bottom: edge.inset, left: 0, right: 0 },
        });
        await page.evaluate((font) => {
          document.documentElement.style.fontSize = font;
          const state = window.trayCheck.useCapture.getState();
          if (state.texts.length < 4) {
            for (let index = 0; index < 4; index++)
              state.addText(`Extra track ${index}`);
          }
          state.patch({ sel: 0, selText: null, selComp: null, sheet: null });
        }, edge.font);
        for (const name of ["Speed", "Crop", "Volume"]) {
          await tools.getByRole("button", { name, exact: true }).click();
          const tray = page.locator(`[data-tool-tray="${name.toLowerCase()}"]`);
          await tray.waitFor();
          await settle(page);
          const movie = await page.locator(".tlClip").first().boundingBox();
          const strip = await page.locator(".tl").boundingBox();
          assert(
            strip.height >= 140,
            `${edge.name}: timeline reserves usable strip space`,
          );
          // Additional tracks may scroll; the strip itself must remain reachable.
          await page.locator(".tlClip").first().scrollIntoViewIfNeeded();
          const visibleMovie = await page
            .locator(".tlClip")
            .first()
            .boundingBox();
          assert(
            visibleMovie.y >= strip.y &&
              visibleMovie.y + movie.height <= strip.y + strip.height + 1,
            `${edge.name}: the full movie strip is reachable`,
          );
          const close = page.getByRole("button", {
            name: "Close tool",
            exact: true,
          });
          await close.tap();
          await tray.waitFor({ state: "hidden" });
          await tools.getByRole("button", { name, exact: true }).waitFor();
          assert.equal(
            await page
              .locator(".editorWorkspace")
              .evaluate((node) => node.scrollWidth > node.clientWidth + 1),
            false,
          );
        }
        await tools
          .getByRole("button", { name: "Volume", exact: true })
          .click();
        await settle(page);
        await page
          .getByRole("slider", { name: "Volume", exact: true })
          .press("ArrowLeft");
        await page.screenshot({
          path: resolve(output, `edge-${edge.name}.png`),
        });
        await page
          .getByRole("button", { name: "Close tool", exact: true })
          .tap();
        console.log(
          `Measured controls: ${edge.name}, multiple tracks and reachable editing/close controls passed.`,
        );
      }
      await cdp.detach();
    }
    await context.close();
    console.log(
      `${width}×${height}, ${theme}: live trays replace the edit toolbar, shared close restores selection and toolbar, preview fit, Undo, Graphs, themes and reduced motion passed.`,
    );
  }
  assert.deepEqual(failures, []);
  console.log(`Tool tray screenshots: ${output}`);
} finally {
  await browser.close();
}
