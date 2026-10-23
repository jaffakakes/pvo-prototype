import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
const browser = await launchBrowser({
  headless: true,
});
const url = process.env.EDITOR_URL || "http://127.0.0.1:5191/";
const output =
  process.env.ORB_SCREENSHOTS || "/private/tmp/restyle-orb-refresh";
await mkdir(output, { recursive: true });
try {
  for (const [width, height, theme] of [
    [393, 852, "light"],
    [430, 932, "dark"],
    [320, 568, "light"],
    [1440, 900, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width < 1024,
    });
    await installAssistantAvailabilityFixture(context);
    const requests = [];
    let release;
    await context.route("**/api/assistant/turn", async (route) => {
      const request = parseNativeTurnRequest(route.request().postDataJSON());
      requests.push(request);
      if (request.prompt === "Wait for me")
        await new Promise((resolve) => {
          release = resolve;
        });
      if (request.prompt === "Try these files") {
        await route.fulfill({ status: 503, json: { error: "Unavailable" } });
        return;
      }
      if (request.prompt === "Add a title and explain") {
        await route.fulfill({
          json: request.execution?.receipts.length
            ? {
                message: "Added your title.",
                answer: "Added JOIN US from 1 to 3 seconds.",
                suggestions: ["Keep JOIN US visible until the clip ends"],
                operations: [],
                observations: [],
              }
            : {
                message: "Adding your title.",
                operations: [
                  {
                    kind: "text.add",
                    sceneId: "main",
                    text: "JOIN US",
                    start: 1,
                    end: 3,
                  },
                ],
                observations: [],
              },
        });
        return;
      }
      try {
        await route.fulfill({
          json: {
            message: "The reference uses pink rounded buttons.",
            operations: [],
            observations: [],
          },
        });
      } catch (error) {
        if (!/closed|cancel|Invalid Interception/i.test(String(error)))
          throw error;
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator("#create-title, .camWrap").first().waitFor();
    await page.evaluate(async (theme) => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      const { useAssistant, resetAssistant } =
        await import("/src/state/assistant/assistantStore.ts");
      const { resetAssistantThread, useAssistantThread } =
        await import("/src/state/assistant/threadStore.ts");
      useCapture.setState(initial());
      resetAssistant();
      useCapture.getState().patch({
        screen: "editor",
        localId: crypto.randomUUID(),
        clips: [mkClip(12, null, 0)],
        music: null,
        muted: true,
        t: 2,
        playing: false,
        sel: -1,
      });
      resetAssistantThread();
      window.capture = useCapture;
      window.assistant = useAssistant;
      window.thread = useAssistantThread;
      document.documentElement.dataset.theme = theme;
    }, theme);
    const orb = page.locator("[data-assistant-orb]");
    const field = page.getByRole("textbox", {
      name: "Describe a change",
      exact: true,
    });
    const snap = async (state) =>
      page.screenshot({ path: `${output}/${width}-${theme}-${state}.png` });
    await orb.click();
    assert.equal(
      await page.getByRole("button", { name: "Start voice input" }).count(),
      0,
    );
    assert.equal(await page.locator("[data-assistant-context]").count(), 0);
    assert.equal(
      await page.getByLabel("Suggested next steps", { exact: true }).count(),
      0,
    );
    assert.equal(await field.getAttribute("placeholder"), "Ask anything");
    assert.equal(
      await page.locator("[data-assistant-composer] button").count(),
      0,
    );
    assert.equal(
      await page
        .locator("[data-assistant-field]")
        .evaluate((element) => getComputedStyle(element).borderWidth),
      "2px",
    );
    if (width < 1024) assert.equal(await page.locator(".toolBar").count(), 0);
    await snap("typing");
    await field.fill("Wait for me");
    assert.equal(await orb.getAttribute("aria-label"), "Send request");
    assert.equal(await orb.locator("img").count(), 0);
    await snap("typing-draft");
    assert.equal(
      await page.getByRole("button", { name: "Fit to 9:16" }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page.locator('[data-assistant-phase="working"]').waitFor();
    assert.equal(await orb.innerText(), "");
    await snap("working");
    await page.evaluate(() =>
      window.assistant.setState({ progress: "Checking the completed edit…" }),
    );
    if (width < 1024) {
      for (const item of [orb, page.locator("[data-assistant-live]")]) {
        const bounds = await item.boundingBox();
        assert(
          Math.abs(bounds.x + bounds.width / 2 - width / 2) <= 1,
          "The orb and progress bubble stay centered during verification",
        );
      }
    }
    await snap("checking");
    if (width < 1024) {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(() => {
        const surface = document.querySelector("[data-editor-surface]");
        const style = getComputedStyle(surface);
        return (
          style.transform === "matrix(0.96, 0, 0, 0.96, 0, 0)" &&
          style.filter === "blur(1.5px)"
        );
      });
      assert.equal(
        await page
          .locator(".editorWorkspace")
          .evaluate((el) => getComputedStyle(el, "::after").opacity),
        "1",
      );
      assert(
        (await orb.boundingBox()).width > 58,
        "The active orb comes forward",
      );
      await snap("focused-working");
      await page.evaluate(async () => {
        const { setReduceMotion } =
          await import("/src/state/preferences/editorPreferences.ts");
        setReduceMotion(true);
      });
      await page.waitForFunction(() => {
        const style = getComputedStyle(
          document.querySelector("[data-editor-surface]"),
        );
        return style.transform === "none" && style.filter === "none";
      });
      assert.equal(
        await orb.evaluate((el) => getComputedStyle(el).transform),
        "none",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(async () => {
        const { setReduceMotion } =
          await import("/src/state/preferences/editorPreferences.ts");
        setReduceMotion(false);
      });
    }
    if (width < 1024) {
      const requestCount = requests.length;
      const historyCount = await page.evaluate(
        () => window.capture.getState().past.length,
      );
      await page
        .getByRole("button", { name: "Minimize assistant", exact: true })
        .click({ position: { x: 20, y: 80 } });
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(".editorWorkspace"),
            "::after",
          ).opacity === "0",
      );
      assert.equal(await page.locator("[data-assistant-live]").count(), 0);
      const toolbar = page.locator(".toolBar");
      await toolbar.waitFor({ state: "visible" });
      assert.equal(
        await toolbar.evaluate((element) => !!element.closest("[inert]")),
        false,
        "Minimizing restores usable editor tools",
      );
      const toolbarBounds = await toolbar.boundingBox();
      const orbBounds = await orb.boundingBox();
      assert(
        orbBounds.y + orbBounds.height <= toolbarBounds.y + 5,
        "The busy orb rests above the returned toolbar",
      );
      await toolbar
        .getByRole("button", { name: "Edit clip", exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.capture.getState().sel), 0);
      await toolbar
        .getByRole("button", { name: "Collapse clip tools", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.capture.getState().sel),
        -1,
      );
      assert.equal(
        await orb.getAttribute("aria-label"),
        "Show request progress",
      );
      assert.equal(await orb.getAttribute("aria-busy"), "true");
      assert.equal(
        await page.evaluate(() => window.assistant.getState().phase),
        "working",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.match(
        await page
          .locator("[data-assistant-orb-ring]")
          .evaluate((el) => getComputedStyle(el).animationName),
        /workingPulse/,
      );
      await snap("minimized-working");
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator("[data-assistant-orb-ring]")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await orb.click();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(".editorWorkspace"),
            "::after",
          ).opacity === "1",
      );
      assert.equal(await page.locator("[data-assistant-live]").count(), 1);
      assert.equal(await page.locator(".toolBar").count(), 0);
      assert.equal(
        requests.length,
        requestCount,
        "Minimize and reopen never restart the request",
      );
      assert.equal(
        await page.evaluate(() => window.capture.getState().past.length),
        historyCount,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await orb.getAttribute("aria-label"),
        "Show request progress",
      );
      release?.();
      await page
        .locator('[data-assistant-phase="review"][data-minimized="true"]')
        .waitFor();
      assert.equal(
        await page.locator("[data-assistant-review]").count(),
        0,
        "A completed answer waits without reopening the focus overlay",
      );
      assert.equal(await orb.getAttribute("aria-busy"), "false");
      assert.equal(
        await orb.getAttribute("aria-label"),
        "View assistant answer",
      );
      assert.equal(await toolbar.isVisible(), true);
      await snap("minimized-ready");
      await orb.click();
      assert.equal(await page.locator(".toolBar").count(), 0);
      await page.getByRole("button", { name: "Keep", exact: true }).click();
      await orb.click();
      await field.fill("Wait for me");
      const retry = page.waitForRequest((request) =>
        request.url().endsWith("/api/assistant/turn"),
      );
      await page
        .getByRole("button", { name: "Send request", exact: true })
        .click();
      await retry;
    }
    assert.equal(await page.locator("[data-assistant-live] button").count(), 0);
    assert.equal(await orb.getAttribute("aria-label"), "Stop request");
    await orb.click();
    await page.locator('[data-assistant-phase="typing"]').waitFor();
    release?.();
    assert.equal(await field.inputValue(), "Wait for me");
    await field.fill("Describe this edit");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page.locator("[data-assistant-review]").waitFor();
    await snap("review");
    await page.getByRole("button", { name: "Keep", exact: true }).click();
    await page.getByRole("button", { name: /Open Restyle thread/ }).click();
    const thread = page.locator("[data-assistant-thread]");
    await thread.waitFor();
    if (width < 1024) {
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(".editorWorkspace"),
            "::after",
          ).opacity === "0",
      );
      assert.equal(await thread.locator("header").count(), 0);
      assert.equal(
        await page
          .getByRole("separator", { name: "Resize Restyle thread" })
          .count(),
        0,
      );
      const geometry = await page
        .locator(".editorWorkspace")
        .evaluate((el) => ({
          h: el.clientHeight,
          dock: parseFloat(
            getComputedStyle(el).getPropertyValue("--dock-height"),
          ),
        }));
      assert(geometry.dock <= geometry.h * 0.65 + 1);
      assert.equal(
        await thread
          .getByRole("button", { name: "Send request", exact: true })
          .count(),
        0,
      );
    }
    await thread.locator('input[type="file"]').setInputFiles([
      {
        name: "brief.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("Make the heading say Join us."),
      },
      {
        name: "reference.png",
        mimeType: "image/png",
        buffer: await readFile(
          new URL("../../../editor/public/restyle-mark.png", import.meta.url),
        ),
      },
    ]);
    await page
      .getByRole("button", { name: "Remove attachment reference.png" })
      .waitFor();
    await field.fill("Try these files");
    await snap("thread");
    const failedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/assistant/turn") &&
        response.status() === 503,
    );
    if (width < 1024) await orb.click();
    else await field.press("Enter");
    await failedResponse;
    await page.waitForFunction(
      () => window.assistant.getState().phase === "typing",
    );
    const failedRequest = requests.find(
      (request) => request.prompt === "Try these files",
    );
    assert.equal(failedRequest.attachments.length, 2);
    assert.equal(
      failedRequest.attachments[0].text,
      "Make the heading say Join us.",
    );
    assert.match(
      failedRequest.attachments[1].dataUrl,
      /^data:image\/jpeg;base64,/,
    );
    await page
      .getByRole("button", { name: "Remove attachment reference.png" })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: /Remove attachment/ }).count(),
      2,
      "Failure preserves attachments",
    );
    await field.fill("Describe these references");
    await field.press("Enter");
    await page.waitForFunction(
      () => window.assistant.getState().attachments.length === 0,
    );
    await page.keyboard.press("Escape");
    await orb.click();
    await field.fill("Add a title and explain");
    await field.press("Enter");
    const beforeButton = page.getByRole("button", {
      name: "Before — hold to compare",
    });
    await beforeButton.waitFor();
    await page
      .getByRole("button", {
        name: "Keep JOIN US visible until the clip ends",
        exact: true,
      })
      .waitFor();
    const historyBeforeCompare = await page.evaluate(
      () => window.capture.getState().past.length,
    );
    await beforeButton.focus();
    await page.keyboard.down("Space");
    await page.locator("[data-assistant-before]").waitFor();
    if (width < 1024) {
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(".editorWorkspace"),
            "::after",
          ).opacity === "0",
      );
    }
    assert.equal(
      await page.evaluate(() => window.capture.getState().past.length),
      historyBeforeCompare,
    );
    assert.equal(
      await page.evaluate(() => window.capture.getState().texts.length),
      1,
    );
    await page.keyboard.up("Space");
    await page
      .locator("[data-assistant-before]")
      .waitFor({ state: "detached" });
    if (width < 1024) assert.equal(await page.locator(".toolBar").count(), 0);
    await snap("review-edit");
    await page
      .locator("[data-assistant-review]")
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.capture.getState().texts.length),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Keep JOIN US visible until the clip ends",
          exact: true,
        })
        .count(),
      0,
    );
    if (width < 1024) {
      await page.locator(".toolBar").waitFor();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(".editorWorkspace"),
            "::after",
          ).opacity === "0",
      );
      assert((await page.locator(".toolBar button").count()) > 0);
      const previewBeforeFocus = await page
        .locator(".previewArea")
        .boundingBox();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await orb.click();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("[data-editor-surface]"))
            .transform === "matrix(0.96, 0, 0, 0.96, 0, 0)",
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => {
        const style = getComputedStyle(
          document.querySelector("[data-editor-surface]"),
        );
        return style.transform === "none" && style.filter === "none";
      });
      assert.deepEqual(
        await page.locator(".previewArea").boundingBox(),
        previewBeforeFocus,
        "Closing the focused assistant restores the exact editor geometry",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    await page.evaluate(() => {
      window.assistant.setState({
        phase: "listening",
        transcript: "Make the heading larger",
      });
    });
    await snap("listening");
    assert.equal(
      await page
        .locator("[data-assistant-orb-ring]")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    console.log(
      `Orb refresh passed: ${width} ${theme}; Stop, attachments, failed-send recovery, transcript and reduced motion.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
