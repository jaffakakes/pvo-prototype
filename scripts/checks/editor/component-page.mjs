import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await launchBrowser({
  headless: true,
});
const artifacts =
  process.env.PVO_EDITOR_ARTIFACTS || "/tmp/restyle-component-page";
await mkdir(artifacts, { recursive: true });
const errors = [];
async function capture(page, path) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let n = 0; n < 4; n++)
      await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await page.screenshot({ path });
}
try {
  for (const [width, height] of [
    [320, 693],
    [393, 852],
    [430, 932],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", {
      waitUntil: "networkidle",
    });
    await page.evaluate(async () => {
      document.documentElement.dataset.theme = "light";
      const { useCapture, mkClip } = await import("/src/store.ts");
      window.pageCapture = useCapture;
      const clip = mkClip(6, null, 0);
      const scene = {
        id: "main",
        name: "Main",
        clips: [clip],
        texts: [],
        components: [],
        muted: true,
        music: null,
        layers: ["video"],
      };
      useCapture.getState().patch({
        scenes: [scene],
        currentSceneId: "main",
        clips: [clip],
        texts: [],
        components: [],
        layers: ["video"],
        screen: "editor",
        t: 0.7,
        sel: -1,
        selComp: null,
        sheet: null,
        playing: false,
        tryMode: null,
        past: [],
        future: [],
      });
      useCapture.getState().addComponent("form");
      await document.fonts.ready;
    });
    await page.getByRole("button", { name: "Design", exact: true }).click();
    const root = page.locator("[data-component-page]");
    await root.waitFor();
    await page.getByRole("button", { name: "Soft", exact: true }).click();
    const state = () =>
      page.evaluate(() => {
        const s = window.pageCapture.getState();
        return {
          c: s.components[0],
          past: s.past.length,
          t: s.t,
          playing: s.playing,
        };
      });
    assert.equal((await state()).c.look.preset, "soft");
    await page.keyboard.press("Meta+z");
    assert.equal((await state()).c.look.preset, "bold");
    assert.equal(
      await page.locator(".pvBox, .timeline").count(),
      0,
      "dedicated page hides the video workspace",
    );
    const beforeChat = await state();
    const orb = page.locator("[data-assistant-orb]");
    await orb.click();
    await page.locator('[data-assistant-focus="true"]').waitFor();
    assert.equal(
      await root.evaluate(
        (element) => getComputedStyle(element, "::after").opacity,
      ),
      "1",
      "one orb tap dims the shared workspace",
    );
    await orb.click();
    const chat = page.getByRole("dialog", {
      name: "Restyle thread",
      exact: true,
    });
    await chat.waitFor();
    assert.equal(await chat.getAttribute("data-variant"), "phone");
    assert.equal(
      await page.locator("[data-assistant-mini-timeline]").count(),
      0,
    );
    assert.equal(await chat.locator("[data-assistant-orb]").count(), 1);
    await capture(page, `${artifacts}/design-chat-${width}.png`);
    const chatInput = chat.getByRole("textbox", { name: "Describe a change" });
    await chatInput.focus();
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, "height", {
        configurable: true,
        value: 360,
      });
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await page
      .locator('[data-component-page][data-keyboard-open="true"]')
      .waitFor();
    assert(
      await chat
        .locator("[data-thread-compose]")
        .evaluate(
          (element) =>
            element.getBoundingClientRect().bottom <= visualViewport.height + 1,
        ),
      "design composer stays above the keyboard",
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      delete visualViewport.height;
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await page
      .locator('[data-component-page][data-keyboard-open="false"]')
      .waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await chat.waitFor({ state: "detached" });
    await orb.dblclick({ delay: 60 });
    await chat.waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await chat.waitFor({ state: "detached" });
    assert.deepEqual(
      await state(),
      beforeChat,
      "chat preserves design and history",
    );
    await capture(page, `${artifacts}/design-${width}.png`);
    await page.getByRole("button", { name: "Style", exact: true }).click();
    await page.getByRole("button", { name: "Background", exact: true }).click();
    await page
      .getByRole("button", { name: "Transparent", exact: true })
      .click();
    assert.equal((await state()).c.look.whole.bg, "none");
    await page
      .getByRole("button", { name: "Use #a78bfa", exact: true })
      .click();
    assert.equal((await state()).c.look.whole.bg, "#A78BFA");
    await page.getByRole("button", { name: "Tint", exact: true }).click();
    await page
      .getByRole("button", { name: "Use #ff2d78", exact: true })
      .click();
    assert.equal((await state()).c.look.whole.bg, "rgba(255, 45, 120, 0.2)");
    await page.getByRole("button", { name: "Solid", exact: true }).click();
    assert.equal((await state()).c.look.whole.bg, "#FF2D78");
    await page.locator('[data-look-part="button:0"]').click();
    await page.getByRole("button", { name: "Solid", exact: true }).click();
    assert.equal(
      (await state()).c.look.btns[0].fill,
      "#FF9FBC",
      "changing kind on another part retains its own hue",
    );
    await capture(page, `${artifacts}/background-${width}.png`);
    const geometry = await root.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      height: element.clientHeight,
      bottom: element.getBoundingClientRect().bottom,
    }));
    assert(
      geometry.scroll <= width && geometry.bottom <= height + 1,
      JSON.stringify(geometry),
    );
    await page.getByRole("button", { name: "Logic", exact: true }).click();
    await page
      .getByRole("button", { name: "Jump to a point", exact: true })
      .click();
    await page
      .getByRole("slider", { name: "Jump to a point in this scene" })
      .fill("2.4");
    assert.equal((await state()).c.fields.outcome.t, 2.4);
    await capture(page, `${artifacts}/logic-${width}.png`);
    await page.getByRole("button", { name: /^Appears/ }).click();
    await page.getByRole("button", { name: "10 s", exact: true }).click();
    assert.equal((await state()).c.dur, 10);
    await page.getByText(/Extends the scene/).waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page
      .getByRole("button", { name: "Send to a URL", exact: true })
      .click();
    const textarea = page.getByRole("textbox", {
      name: "Component logic code",
    });
    await textarea.fill("on submit { BROKEN }");
    await page
      .getByRole("status")
      .filter({ hasText: /Logic.*line/ })
      .waitFor();
    await capture(page, `${artifacts}/code-error-${width}.png`);
    await page.getByRole("button", { name: "Expand language editor" }).click();
    await capture(page, `${artifacts}/code-expanded-${width}.png`);
    await page.getByRole("button", { name: "Whole form", exact: true }).click();
    await page
      .getByText("Your code needs attention", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^Appears/ }).click();
    await page.getByRole("button", { name: "5 s", exact: true }).click();
    assert.equal(
      (await state()).c.dur,
      5,
      "timing stays editable beside an invalid draft",
    );
    await page
      .getByRole("button", { name: "Restore previous version", exact: true })
      .click();
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await root.waitFor({ state: "detached" });
    await page.evaluate(() => {
      const state = window.pageCapture.getState();
      const id = state.addComponent("choice");
      window.choiceId = id;
    });
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator('[data-look-part="button:1"]').click();
    await page.getByRole("button", { name: "Logic", exact: true }).click();
    await page
      .getByRole("heading", { name: "When someone taps Option B", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator('[data-look-part="button:1"]')
        .getAttribute("data-part-selected"),
      "true",
    );
    await page.evaluate(() =>
      window.pageCapture.getState().deleteComponent(window.choiceId),
    );
    await page.evaluate(() => {
      const state = window.pageCapture.getState();
      state.patch({ selComp: state.components[0].id });
    });

    await page.getByRole("button", { name: "Design", exact: true }).click();
    await root.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Design", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Component page: responsive layout, design undo, routing, timing, invalid code, restore and explicit Design entry passed.",
  );
} finally {
  await browser.close();
}
