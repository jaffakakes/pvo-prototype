import { launchBrowser } from "../helpers/browser.mjs";
import { finishTextEntry } from "../helpers/editor-text.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
const browser = await launchBrowser({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const [width, height, theme = "light"] of [
    [320, 568],
    [390, 844],
    [390, 844, "dark"],
    [662, 977],
    [844, 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { settle, geometry } = createSheetDockChecks(page);
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').setInputFiles(videoFile);
      await page
        .getByRole("button", { name: "Open editor", exact: true })
        .click();
      await settle();
      assert.equal(await page.locator(".editorHead button").count(), 3);
      const navigation = page.getByRole("banner", {
        name: "Editor navigation",
        exact: true,
      });
      const back = navigation.getByRole("button", {
        name: "Back to camera",
        exact: true,
      });
      const signIn = navigation.getByRole("button", {
        name: "Sign in",
        exact: true,
      });
      const navigationBounds = await Promise.all(
        [back, signIn].map((button) => button.boundingBox()),
      );
      assert(
        navigationBounds.every(
          (box) =>
            box &&
            box.width >= 44 &&
            box.height >= 44 &&
            box.x >= 0 &&
            box.x + box.width <= width,
        ),
        "Navigation keeps reachable touch targets inside the viewport",
      );
      assert(
        navigationBounds[0].x + navigationBounds[0].width <
          navigationBounds[1].x,
        "Navigation buttons do not collide",
      );
      assert.equal(
        await signIn.innerText(),
        "Sign in",
        "Sign in stays labelled at every width",
      );
      const title = navigation.getByRole("textbox", {
        name: "Project title",
        exact: true,
      });
      const titleBox = await title.boundingBox();
      assert(
        titleBox &&
          titleBox.height >= 44 &&
          titleBox.x >= navigationBounds[0].x + navigationBounds[0].width &&
          titleBox.x + titleBox.width <= navigationBounds[1].x,
        "The editable title fits between navigation controls",
      );
      await signIn.click();
      const auth = page.getByRole("dialog");
      await auth.waitFor();
      await auth
        .getByRole("button", { name: "Close sign in", exact: true })
        .click();
      await auth.waitFor({ state: "hidden" });
      if (process.env.PVO_EDITOR_ARTIFACTS) {
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/navigation-${width}x${height}-${theme}.png`,
        });
      }
      assert.equal(
        await page.locator(".editorHead p").count(),
        1,
        "Save status sits beneath the title",
      );
      assert.equal(
        await page
          .locator(".editorHead")
          .getByRole("button", { name: "More", exact: true })
          .count(),
        0,
      );
      const controls = page.getByRole("toolbar", {
        name: "Playback controls",
        exact: true,
      });
      const play = page.getByRole("button", { name: "Play", exact: true });
      const undo = controls.getByRole("button", { name: "Undo", exact: true });
      const redo = controls.getByRole("button", { name: "Redo", exact: true });
      const trying = controls.getByRole("button", { name: "Try", exact: true });
      const bounds = await Promise.all(
        [play, undo, redo, trying].map((button) => button.boundingBox()),
      );
      assert(
        bounds.every(
          (b) =>
            b &&
            b.width >= 44 &&
            b.height >= 44 &&
            b.x >= 0 &&
            b.x + b.width <= width,
        ),
      );
      for (let i = 2; i < bounds.length; i++)
        assert(bounds[i].x >= bounds[i - 1].x + bounds[i - 1].width);
      const look = await play.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          border: style.borderWidth,
          radius: style.borderRadius,
          background: style.backgroundColor,
          shadow: style.boxShadow,
        };
      });
      assert.deepEqual(look, {
        border: "0px",
        radius: "0px",
        background: "rgba(0, 0, 0, 0)",
        shadow: "none",
      });
      const layout = await geometry();
      assert.equal(
        layout.header.height,
        64,
        "The project header stays compact",
      );
      assert.equal(
        layout.preview.bottom,
        layout.controlsRow ? layout.transport.top : layout.previewArea.bottom,
        "The video stops above a separate controls row when gutters are too narrow",
      );
      assert(
        Math.abs(layout.previewArea.bottom - layout.dock.top) < 1,
        "The preview region meets the scene row",
      );
      assert.equal(
        layout.previewArea.top,
        layout.header.bottom,
        "The player starts directly below the header",
      );
      if (height >= 500) assert(layout.dock.height <= (height * 3) / 8 + 2);
      const stamp = page.locator(".transportTime");
      const stampBox = await stamp.boundingBox();
      assert(
        stampBox.x >= layout.preview.left - 1 &&
          stampBox.x + stampBox.width <= layout.preview.right + 1,
        "Timestamp fits inside the video's right corner",
      );
      assert(
        stampBox.y + stampBox.height <= layout.preview.bottom,
        "Timestamp fits above the video's bottom edge",
      );
      assert.equal(
        await stamp.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(255, 255, 255, 0.75)",
      );
      assert(
        Math.abs(
          bounds[0].x +
            bounds[0].width / 2 -
            (layout.preview.left + layout.preview.right) / 2,
        ) < 1 &&
          Math.abs(
            bounds[0].y +
              bounds[0].height / 2 -
              (layout.preview.top + layout.preview.bottom) / 2,
          ) < 1,
        "Play stays centred on the video",
      );
      for (const box of bounds.slice(1)) {
        const horizontal =
          Math.min(box.x + box.width, layout.preview.right) -
          Math.max(box.x, layout.preview.left);
        const vertical =
          Math.min(box.y + box.height, layout.preview.bottom) -
          Math.max(box.y, layout.preview.top);
        assert(
          horizontal <= 0 || vertical <= 0,
          "Editing buttons never overlap the video",
        );
      }
      assert(
        Math.abs(bounds[1].x - 8) < 1 &&
          Math.abs(bounds[3].x + bounds[3].width - width + 8) < 1,
        "Undo and Preview anchor to opposite lower player corners",
      );
      await play.click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      const feedback = page.locator("[data-playback-feedback]");
      await page
        .locator('[data-playback-feedback][data-visible="true"]')
        .waitFor();
      await page.waitForTimeout(350);
      assert.deepEqual(
        await stamp.boundingBox(),
        stampBox,
        "Timestamp stays fixed during playback",
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("[data-playback-feedback]"))
            .opacity === "0",
      );
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page
        .locator('[data-playback-feedback][data-visible="true"]')
        .waitFor();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("[data-playback-feedback]"))
            .opacity === "0",
      );
      await page.getByRole("button", { name: "Text", exact: true }).click();
      const text = page.getByRole("dialog", { name: "Add text", exact: true });
      assert.equal(
        await text.locator("h2").count(),
        0,
        "The compact text composer has no visible heading",
      );
      assert.equal(
        await text.getByRole("tablist").count(),
        0,
        "Text controls use an icon row",
      );
      const entry = await text
        .getByRole("textbox", { name: "Text content", exact: true })
        .boundingBox();
      assert(entry && entry.height <= 46, "Text entry stays compact");
      assert.deepEqual(
        await text
          .locator(".textTools button")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute("aria-label")),
          ),
        [
          "Text fonts",
          "Text colours",
          "Font styles",
          "Text alignment",
          "Text effects",
        ],
      );
      assert.equal(
        await text.evaluate(
          (el) => getComputedStyle(el.closest("[data-active]")).borderTopWidth,
        ),
        "0px",
        "The text panel has no top border",
      );
      assert.equal(
        await controls.isVisible(),
        false,
        "Text entry hides playback",
      );
      const focusState = await text
        .getByRole("textbox", { name: "Text content", exact: true })
        .evaluate((el) => ({
          focused: document.activeElement === el,
          active: document.activeElement?.outerHTML.slice(0, 300),
          visibility: getComputedStyle(el).visibility,
          inert: !!el.closest("[inert]"),
        }));
      assert(
        focusState.focused,
        `Text entry opens with the field focused: ${JSON.stringify(focusState)}`,
      );
      assert.equal(
        await text.getByRole("button", { name: "Done", exact: true }).count(),
        0,
        "The keyboard-down control replaces the checkmark while typing",
      );
      const previewKeyboard = text.getByRole("group", {
        name: "On-screen keyboard",
        exact: true,
      });
      const content = text.getByRole("textbox", {
        name: "Text content",
        exact: true,
      });
      if (width === 390) {
        assert.equal(
          await previewKeyboard.count(),
          0,
          "Touch devices use the native keyboard",
        );
      } else {
        assert.equal(
          await previewKeyboard.isVisible(),
          true,
          "The desktop phone preview shows a usable keyboard",
        );
        await settle();
        const keyboardBox = await previewKeyboard.boundingBox();
        assert(
          keyboardBox &&
            keyboardBox.y >= 0 &&
            keyboardBox.y + keyboardBox.height <= height + 2,
          `Keyboard bounds at ${width} × ${height}: ${JSON.stringify(keyboardBox)}`,
        );
        await previewKeyboard
          .getByRole("button", { name: "Key Q", exact: true })
          .click();
        await previewKeyboard
          .getByRole("button", { name: "Key W", exact: true })
          .click();
        assert.equal(await content.inputValue(), "Qw");
        await previewKeyboard
          .getByRole("button", { name: "Backspace", exact: true })
          .click();
        await previewKeyboard
          .getByRole("button", { name: "Numbers", exact: true })
          .click();
        await previewKeyboard
          .getByRole("button", { name: "Key 1", exact: true })
          .click();
        await previewKeyboard
          .getByRole("button", { name: "Space", exact: true })
          .click();
        await previewKeyboard
          .getByRole("button", { name: "Return", exact: true })
          .click();
        assert.equal(await content.inputValue(), "Q1 \n");
        await content.fill("");
      }
      await text
        .getByRole("button", { name: "Hide keyboard", exact: true })
        .click();
      assert.equal(
        await previewKeyboard.count(),
        0,
        "Keyboard-down dismisses the preview keyboard",
      );
      const columns = await text
        .locator(".textPresets")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      assert.equal(columns, 3, "Designs use three compact columns");
      await finishTextEntry(text);
      assert.equal(
        await page.locator(".textBar").count(),
        0,
        "An empty checkmark closes without adding a text layer",
      );
      await page.getByRole("button", { name: "Text", exact: true }).click();
      await text
        .getByRole("textbox", { name: "Text content", exact: true })
        .fill("History stays beside Play");
      const accentBefore = await page
        .locator("html")
        .getAttribute("data-accent");
      await text
        .getByRole("button", { name: "Text colours", exact: true })
        .click();
      const swatches = text.getByRole("group", {
        name: "Text colour",
        exact: true,
      });
      assert.equal(
        await text.locator('input[type="color"]').count(),
        0,
        "Colour selection uses swatches, not the native colour dialog",
      );
      const paletteBox = await swatches.boundingBox();
      const entryBox = await text
        .getByRole("textbox", { name: "Text content", exact: true })
        .boundingBox();
      assert(
        paletteBox &&
          entryBox &&
          paletteBox.y + paletteBox.height <= entryBox.y,
        "The swatches sit above the text field",
      );
      await swatches.getByRole("button", { name: "Red", exact: true }).click();
      assert.equal(
        await swatches
          .getByRole("button", { name: "Red", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert(
        await text
          .getByRole("textbox", { name: "Text content", exact: true })
          .evaluate((el) => document.activeElement === el),
        "Swatches keep the text field focused for the native keyboard",
      );
      assert.equal(
        await page.locator("html").getAttribute("data-accent"),
        accentBefore,
        "Choosing text colour does not change the app accent",
      );
      if (width === 390) {
        await page.evaluate(() => {
          Object.defineProperty(window.visualViewport, "height", {
            configurable: true,
            value: innerHeight - 300,
          });
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page
          .locator('.editorWorkspace[data-keyboard-open="true"]')
          .waitFor();
        await settle();
        const toolBox = await text
          .getByRole("toolbar", { name: "Text tools", exact: true })
          .boundingBox();
        assert(
          toolBox &&
            Math.abs(toolBox.y + toolBox.height - (height - 300 - 12)) < 3,
          "The text toolbar sits immediately above the native keyboard",
        );
        assert.equal(
          await text.locator(".textPresets").isVisible(),
          false,
          "The keyboard replaces the design panel while typing",
        );
        await page.evaluate(() => {
          delete window.visualViewport.height;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page
          .locator('.editorWorkspace[data-keyboard-open="false"]')
          .waitFor();
        await settle();
      }
      await text
        .getByRole("button", { name: "Close colours", exact: true })
        .click();
      assert.equal(await swatches.count(), 0);
      await text
        .getByRole("button", { name: "Text fonts", exact: true })
        .click();
      await text
        .getByRole("button", { name: "Use Georgia font", exact: true })
        .click();
      await text
        .getByRole("button", { name: "More fonts", exact: true })
        .click();
      assert.equal(
        await text
          .getByRole("textbox", { name: "Search web fonts", exact: true })
          .isVisible(),
        true,
        "The font tile opens the existing font library",
      );
      await text
        .getByRole("button", { name: "Close fonts", exact: true })
        .click();
      await text
        .getByRole("button", { name: "Font styles", exact: true })
        .click();
      assert.equal(
        await text
          .getByRole("group", { name: "Text styles", exact: true })
          .isVisible(),
        true,
      );
      assert.equal(
        await text
          .getByRole("group", { name: "Text fonts", exact: true })
          .count(),
        0,
      );
      await text
        .getByRole("button", { name: "Text fonts", exact: true })
        .click();
      assert.equal(
        await text
          .getByRole("button", { name: "Use Georgia font", exact: true })
          .getAttribute("aria-pressed"),
        "true",
        "Opening styles does not change the font",
      );
      await text
        .getByRole("button", { name: "Text effects", exact: true })
        .click();
      await text
        .getByRole("button", { name: "Apply Pop effect", exact: true })
        .click();
      await finishTextEntry(text);
      await page.locator(".textBar").waitFor();
      await page
        .getByRole("button", {
          name: "Edit text: History stays beside Play",
          exact: true,
        })
        .click();
      const editText = page.getByRole("dialog", {
        name: "Edit text",
        exact: true,
      });
      await editText
        .getByRole("button", { name: "Text colours", exact: true })
        .click();
      assert.equal(
        await editText
          .getByRole("button", { name: "Red", exact: true })
          .getAttribute("aria-pressed"),
        "true",
        "The selected colour is saved with the text",
      );
      await editText
        .getByRole("button", { name: "Text effects", exact: true })
        .click();
      assert.equal(
        await editText
          .getByRole("button", { name: "Apply Pop effect", exact: true })
          .getAttribute("aria-pressed"),
        "true",
        "The chosen effect is saved with the text",
      );
      await finishTextEntry(editText);
      await undo.click();
      assert.equal(await page.locator(".textBar").count(), 0);
      await redo.click();
      await page.locator(".textBar").waitFor();
      await trying.click();
      const stop = page.getByRole("button", {
        name: "Stop trying",
        exact: true,
      });
      await stop.waitFor();
      await stop.click();
      await trying.waitFor();
      await settle();
      if (height >= 500)
        assert((await geometry()).dock.height <= (height * 3) / 8 + 2);
      await page
        .getByRole("button", { name: "Back to camera", exact: true })
        .click();
      await page.locator(".viewfinder").waitFor();
      assert.deepEqual(errors, []);
      console.log(`Playback chrome passed at ${width} × ${height} ${theme}.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
