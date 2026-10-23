import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";

import {
  parseNativeTurnRequest,
  parseNativeTurnResult,
} from "../../../packages/pvo-assistant/native/index.js";
import {
  finishAssistantVerification,
  installAssistantAvailabilityFixture,
} from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";

const browser = await launchBrowser({
  headless: true,
  args: ["--no-sandbox"],
});

const answerPrompt = "Describe this edit";
const editPrompt = "Add a short title";
const pendingPrompt = "Hold this request";
const answerText = "This edit has one twelve-second clip.";

async function state(page) {
  return page.evaluate(() => {
    const capture = window.capture.getState();
    return {
      texts: capture.texts.map((item) => item.text),
      past: capture.past.length,
      future: capture.future.length,
      localId: capture.localId,
    };
  });
}

async function assertNoOverflow(page, label) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `${label}: thread must not widen the page`,
  );
}

async function phoneGeometry(page) {
  return page.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    return {
      dock: bounds(".editorDock"),
      preview: bounds(".previewArea"),
      composer: bounds("[data-thread-compose]"),
      band: bounds("[data-assistant-mini-timeline]"),
      transcript: bounds("[data-assistant-thread] ol"),
    };
  });
}

async function settleLayout(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function run(variant, width, height) {
  const label = `${variant}-${width}x${height}`;
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: variant === "phone",
    reducedMotion: "reduce",
  });
  await installAssistantAvailabilityFixture(context);
  const calls = [];
  let releasePending;
  const pendingGate = new Promise((resolve) => {
    releasePending = resolve;
  });
  await context.route("**/api/assistant/turn", async (route) => {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    assert.equal(
      request.mode,
      "plan",
      `${label}: native planner must handle each thread request`,
    );
    if (await finishAssistantVerification(route, request)) return;
    calls.push(request);
    if (request.prompt === answerPrompt) {
      await route.fulfill({
        json: parseNativeTurnResult({
          message: answerText,
          operations: [],
          observations: [],
        }),
      });
      return;
    }
    if (request.prompt === pendingPrompt) {
      await pendingGate;
      try {
        await route.fulfill({
          json: parseNativeTurnResult({
            message: "No change made.",
            operations: [],
            observations: [],
          }),
        });
      } catch (error) {
        if (!/closed|cancel|Invalid Interception/i.test(String(error)))
          throw error;
      }
      return;
    }
    assert.equal(
      request.prompt,
      editPrompt,
      `${label}: unexpected assistant request`,
    );
    await route.fulfill({
      json: parseNativeTurnResult({
        message: "Preparing a title.",
        operations: [
          {
            kind: "text.add",
            sceneId: "main",
            text: "A fresh start",
            start: 1,
            end: 3,
          },
        ],
        observations: [],
      }),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const orb = page.locator("[data-assistant-orb]");
  const thread = page.locator("[data-assistant-thread]");
  const field = page.getByRole("textbox", {
    name: "Describe a change",
    exact: true,
  });
  const send = page.getByRole("button", { name: "Send request", exact: true });
  const submit = async () =>
    variant === "phone" && (await thread.isVisible())
      ? orb.click()
      : send.click();

  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#create-title, .camWrap").first().waitFor();
    await page.evaluate(async () => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      const { resetAssistant } =
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
        selComp: null,
        selText: null,
      });
      resetAssistantThread();
      window.capture = useCapture;
      window.assistantThread = useAssistantThread;
    });
    await orb.waitFor();
    await page.waitForFunction(() => !document.querySelector("#root").inert);

    if (variant === "phone") {
      await page.evaluate(() =>
        window.assistantThread.setState({ open: true }),
      );
      await thread.waitFor();
      await settleLayout(page);
      assert.equal(
        await page.getByRole("button", { name: "Done", exact: true }).count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("textbox", { name: "Project title", exact: true })
          .isVisible(),
        false,
        `${label}: full conversation removes the project header`,
      );
      assert.equal(
        await page
          .locator(".editorWorkspace")
          .evaluate((element) =>
            getComputedStyle(element)
              .getPropertyValue("--header-height")
              .trim(),
          ),
        "0px",
        `${label}: the player receives the entire former header row`,
      );
      const emptyLayout = await page.evaluate(() => {
        const empty = document
          .querySelector("[data-assistant-thread] ol li")
          .getBoundingClientRect();
        const list = document
          .querySelector("[data-assistant-thread] ol")
          .getBoundingClientRect();
        const compose = document
          .querySelector("[data-thread-compose]")
          .getBoundingClientRect();
        const orb = document
          .querySelector("[data-assistant-orb]")
          .getBoundingClientRect();
        return {
          centered:
            Math.abs(
              (empty.top + empty.bottom) / 2 - (list.top + list.bottom) / 2,
            ) < 8,
          orbInside:
            orb.left >= compose.left &&
            orb.right <= compose.right &&
            orb.top >= compose.top &&
            orb.bottom <= compose.bottom,
        };
      });
      assert(
        emptyLayout.centered,
        `${label}: the empty conversation is centered in the transcript`,
      );
      assert(
        emptyLayout.orbInside,
        `${label}: the send/voice orb belongs inside the composer`,
      );
      const playhead = thread.getByRole("slider", {
        name: "Playhead — drag to a moment",
      });
      await playhead.focus();
      await page.keyboard.press("ArrowRight");
      const scrubbed = await page.evaluate(() => ({
        time: window.capture.getState().t,
        past: window.capture.getState().past.length,
      }));
      assert(
        Math.abs(scrubbed.time - 2.1) < 0.01,
        `${label}: mini timeline seeks by 0.1 seconds (actual ${scrubbed.time})`,
      );
      assert.equal(scrubbed.past, 0, `${label}: seeking never creates an edit`);
      await page.keyboard.press("Shift+ArrowRight");
      assert(
        Math.abs(
          (await page.evaluate(() => window.capture.getState().t)) - 3.1,
        ) < 0.01,
      );
      await thread.locator('input[type="file"]').setInputFiles({
        name: "brief.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Use softer colours."),
      });
      await thread
        .getByRole("button", { name: "Remove attachment brief.txt" })
        .waitFor();
      await thread
        .getByRole("button", { name: "Remove attachment brief.txt" })
        .click();
      await page.getByRole("button", { name: "Play", exact: true }).click();
      assert(
        await thread.isVisible(),
        `${label}: tapping the video keeps the conversation open`,
      );
      assert(
        await page.evaluate(() => window.capture.getState().playing),
        `${label}: tapping the video starts playback`,
      );
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await thread.waitFor({ state: "detached" });
      assert(
        await page
          .getByRole("textbox", { name: "Project title", exact: true })
          .isVisible(),
        `${label}: Done restores the normal timeline header`,
      );
    }

    // The first request uses the native composer and produces a read-only answer.
    await orb.click();
    await field.waitFor();
    assert.equal(
      await field.count(),
      1,
      `${label}: one composer when the thread is empty`,
    );
    await field.fill(answerPrompt);
    await submit();
    const answer = page.locator("[data-assistant-review]");
    await answer.getByText(answerText, { exact: true }).waitFor();
    assert.equal(
      (await state(page)).past,
      0,
      `${label}: an answer is not a project edit`,
    );
    await answer.getByRole("button", { name: "Keep", exact: true }).click();

    // The separate count button reveals earlier exchanges without changing orb tap behavior.
    await page
      .getByRole("button", { name: "Open Restyle thread, 1 exchange" })
      .click();
    await thread.waitFor();
    assert.equal(
      await field.count(),
      1,
      `${label}: one composer when the thread is open`,
    );
    assert.equal(
      await thread.locator('[data-exchange-status="answered"]').count(),
      1,
    );
    assert.equal(
      await thread
        .locator("p")
        .getByText(answerPrompt, { exact: true })
        .count(),
      1,
    );
    await field.fill(editPrompt);
    await submit();
    await page.locator('[data-notification-id="assistantApplied"]').waitFor();
    assert.deepEqual(
      (await state(page)).texts,
      ["A fresh start"],
      `${label}: native batch applies once`,
    );
    assert.equal((await state(page)).past, 1);

    await thread.waitFor();
    const applied = thread.locator('[data-exchange-status="applied"]');
    await applied.waitFor();
    assert.equal(
      await thread.locator('[data-exchange-status="answered"]').count(),
      1,
    );
    if ((await field.count()) === 0) await orb.click();
    assert.equal(
      await field.count(),
      1,
      `${label}: the thread offers one composer after applying an edit`,
    );
    await applied.getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual(
      (await state(page)).texts,
      [],
      `${label}: row Undo reverts its edit`,
    );
    assert.equal(await applied.getAttribute("data-undone"), "true");
    await applied.getByRole("button", { name: "Redo", exact: true }).click();
    assert.deepEqual(
      (await state(page)).texts,
      ["A fresh start"],
      `${label}: row Redo restores its edit`,
    );

    await page.evaluate(() =>
      window.capture.getState().addText("A later manual edit"),
    );
    assert.equal(
      await applied
        .getByRole("button", { name: "Undo", exact: true })
        .isDisabled(),
      true,
      `${label}: an older exchange cannot consume a later history step`,
    );
    await assertNoOverflow(page, label);

    if (variant === "phone") {
      const geometry = await phoneGeometry(page);
      assert(
        geometry.preview.height >= 190,
        `${label}: the player remains visible above the thread`,
      );
      assert(
        geometry.dock.height > 0 && geometry.composer.bottom <= height + 1,
        `${label}: the thread composer fits in the phone viewport`,
      );

      assert.equal(
        await page
          .getByRole("separator", { name: "Resize Restyle thread" })
          .count(),
        0,
      );
      assert.equal(await thread.locator("header").count(), 0);
      const resized = geometry;
      const keyboardInset = width === 390 ? 336 : 236;
      await page.evaluate(() => {
        const store = window.assistantThread;
        window.originalKeyboardItems = store.getState().items;
        const example = store.getState().items[0];
        store.setState({
          items: [
            ...Array.from({ length: 8 }, (_, index) => ({
              ...example,
              id: `keyboard-history-${index}`,
              request: `Earlier request ${index}`,
            })),
            ...store.getState().items,
          ],
        });
      });
      const transcript = thread.locator("ol");
      await transcript.evaluate((element) => {
        element.scrollTop = 60;
        element.dispatchEvent(new Event("scroll"));
      });
      const scrollBeforeKeyboard = await transcript.evaluate(
        (element) => element.scrollTop,
      );
      assert(
        scrollBeforeKeyboard > 0,
        `${label}: earlier transcript is scrollable`,
      );
      await field.focus();
      await page.evaluate((inset) => {
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          value: innerHeight - inset,
        });
        window.visualViewport.dispatchEvent(new Event("resize"));
      }, keyboardInset);
      await page
        .locator('.editorWorkspace[data-keyboard-open="true"]')
        .waitFor();
      await settleLayout(page);
      const keyboard = await phoneGeometry(page);
      assert(
        keyboard.preview.height >= 190,
        `${label}: footage stays usable with the keyboard open`,
      );
      assert(
        keyboard.composer.bottom <= height - keyboardInset + 1,
        `${label}: the composer remains above the simulated OS keyboard`,
      );
      assert.equal(
        await thread.locator("[data-exchange-id]").count(),
        10,
        `${label}: the transcript keeps earlier exchanges with the keyboard open`,
      );
      assert.equal(
        keyboard.transcript.height,
        0,
        `${label}: keyboard folds the transcript`,
      );
      assert.equal(
        Math.round(keyboard.band.height),
        68,
        `${label}: keyboard band keeps ruler and clips only`,
      );
      assert.equal(
        await page.getByRole("toolbar", { name: "Playback controls" }).count(),
        0,
        `${label}: transport is removed while typing`,
      );
      assert(
        Math.abs(
          keyboard.dock.height -
            keyboard.band.height -
            keyboard.composer.height -
            10,
        ) < 2,
        `${label}: the sheet is sized by its band and composer`,
      );
      const headBefore = await page.evaluate(() => window.capture.getState().t);
      const head = thread.getByRole("slider", {
        name: "Playhead — drag to a moment",
      });
      const headBox = await head.boundingBox();
      await page.mouse.click(headBox.x + headBox.width * 0.6, headBox.y + 25);
      assert(
        await field.evaluate((element) => element === document.activeElement),
        `${label}: scrubbing keeps the keyboard's textarea focused`,
      );
      assert.notEqual(
        await page.evaluate(() => window.capture.getState().t),
        headBefore,
      );
      await field.fill("One\nTwo\nThree\nFour\nFive\nSix");
      await settleLayout(page);
      const grown = await phoneGeometry(page);
      assert(
        grown.composer.height > keyboard.composer.height,
        `${label}: draft grows upward`,
      );
      assert(
        await field.evaluate((element) => element.clientHeight <= 80),
        `${label}: draft stops at four lines`,
      );
      assert(grown.composer.bottom <= height - keyboardInset + 1);
      // Safari may pan the visual viewport toward the focused field.
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "offsetTop", {
          configurable: true,
          value: 32,
        });
        window.visualViewport.dispatchEvent(new Event("scroll"));
      });
      await settleLayout(page);
      assert(
        (
          await page
            .getByRole("button", { name: "Done", exact: true })
            .boundingBox()
        ).y >= 32,
        `${label}: the editor's top stays in Safari's panned visual viewport`,
      );
      // iOS can report already-panned client rects during keyboard animation.
      // Reproduce that coordinate mismatch as well as a pan large enough that
      // subtracting it from keyboard occlusion would misclassify the keyboard.
      const safariPan = keyboardInset - 64;
      await page.evaluate((pan) => {
        const workspace = document.querySelector(".editorWorkspace");
        workspace.getBoundingClientRect = function () {
          const rect = Element.prototype.getBoundingClientRect.call(this);
          return new DOMRect(
            rect.x,
            rect.y - visualViewport.offsetTop,
            rect.width,
            rect.height,
          );
        };
        Object.defineProperty(window.visualViewport, "offsetTop", {
          configurable: true,
          value: pan,
        });
        window.visualViewport.dispatchEvent(new Event("scroll"));
      }, safariPan);
      await settleLayout(page);
      assert.equal(
        await page
          .locator(".editorWorkspace")
          .getAttribute("data-keyboard-open"),
        "true",
        `${label}: Safari panning does not turn off the keyboard layout`,
      );
      for (let event = 0; event < 3; event++) {
        await page.evaluate(() =>
          visualViewport.dispatchEvent(new Event("scroll")),
        );
        await settleLayout(page);
      }
      const safari = await phoneGeometry(page);
      const doneBox = await page
        .getByRole("button", { name: "Done", exact: true })
        .boundingBox();
      assert(
        doneBox.y - safariPan >= 0 && doneBox.y - safariPan < 20,
        `${label}: no blank gap above Done after Safari pans`,
      );
      assert(
        safari.composer.bottom - safariPan <= height - keyboardInset + 1,
        `${label}: the composer stays visible after repeated Safari scroll events`,
      );
      await page.evaluate(() => {
        delete document.querySelector(".editorWorkspace").getBoundingClientRect;
        delete window.visualViewport.offsetTop;
        window.visualViewport.dispatchEvent(new Event("scroll"));
      });
      await settleLayout(page);
      await assertNoOverflow(page, `${label} with keyboard`);

      const playingBeforeDismiss = await page.evaluate(
        () => window.capture.getState().playing,
      );
      await page.locator(".pvBox").click();
      assert.equal(
        await page.evaluate(() => window.capture.getState().playing),
        playingBeforeDismiss,
        `${label}: tapping the video dismisses the keyboard before playback`,
      );
      await page.evaluate(() => {
        delete window.visualViewport.height;
        delete window.visualViewport.offsetTop;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await page
        .locator('.editorWorkspace[data-keyboard-open="false"]')
        .waitFor();
      await settleLayout(page);
      const restored = await phoneGeometry(page);
      assert(
        Math.abs(restored.dock.height - resized.dock.height) < 2,
        `${label}: keyboard dismissal restores the chosen dock height`,
      );
      assert.equal(
        await transcript.evaluate((element) => element.scrollTop),
        scrollBeforeKeyboard,
        `${label}: keyboard dismissal restores the transcript scroll position`,
      );
      await page.evaluate(() =>
        window.assistantThread.setState({
          items: window.originalKeyboardItems,
        }),
      );

      // Moving from the phone editor to the desktop editor unmounts the old orb.
      // A request already in flight must leave a cancelled row, not an eternal spinner.
      const pendingRequest = page.waitForRequest(
        (request) =>
          request.url().includes("/api/assistant/turn") &&
          request.postDataJSON()?.prompt === pendingPrompt,
      );
      await field.fill(pendingPrompt);
      await field.focus();
      await page.evaluate((inset) => {
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          value: innerHeight - inset,
        });
        window.visualViewport.dispatchEvent(new Event("resize"));
      }, keyboardInset);
      await page
        .locator('.editorWorkspace[data-keyboard-open="true"]')
        .waitFor();
      let releaseStatus;
      const statusGate = new Promise((resolve) => {
        releaseStatus = resolve;
      });
      const delayStatus = async (route) => {
        await statusGate;
        await route.fallback();
      };
      await context.route("**/api/assistant/status", delayStatus);
      await submit();
      const workingStatus = thread.locator("[data-assistant-working]");
      await workingStatus.waitFor({ state: "attached" });
      assert(
        await field.evaluate(
          (element) =>
            element === document.activeElement &&
            element.readOnly &&
            !element.disabled,
        ),
        `${label}: sending keeps the keyboard focused while the draft is read-only`,
      );
      assert.equal(
        await workingStatus.isVisible(),
        false,
        `${label}: work stays in the folded transcript while typing`,
      );
      assert.equal(
        await orb.getAttribute("aria-label"),
        "Stop request",
        `${label}: the send button becomes Stop during the availability check`,
      );
      assert.equal(await orb.getAttribute("aria-busy"), "true");
      assert.equal(await orb.locator("[data-assistant-stop]").count(), 1);
      assert.equal(
        await workingStatus.locator("img").count(),
        1,
        `${label}: a pending exchange shows the Restyle logo`,
      );
      const firstWord = await workingStatus
        .locator("[data-working-word]")
        .textContent();
      await page.waitForFunction(
        (first) =>
          document.querySelector("[data-working-word]")?.textContent !== first,
        firstWord,
        { timeout: 6000 },
      );
      if (process.env.PVO_ASSISTANT_SCREENSHOT && width === 390)
        await page.screenshot({ path: process.env.PVO_ASSISTANT_SCREENSHOT });
      releaseStatus();
      await pendingRequest;
      await context.unroute("**/api/assistant/status", delayStatus);
      assert.equal(
        await page.locator("[data-assistant-live]").count(),
        0,
        `${label}: the thread has one working status without a second floating bubble`,
      );
      assert(
        await field.evaluate(
          (element) =>
            element === document.activeElement &&
            element.readOnly &&
            !element.disabled,
        ),
        `${label}: generating also preserves the keyboard`,
      );
      await page.evaluate(() => {
        delete window.visualViewport.height;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(
        () =>
          window.assistantThread.getState().items.at(-1)?.status ===
          "cancelled",
      );
      releasePending();
      await page.locator("[data-desktop-editor]").waitFor();
      await settleLayout(page);
      await thread.waitFor();
      assert.equal(
        await thread.locator('[data-exchange-status="cancelled"]').count(),
        1,
        `${label}: viewport handoff records the interrupted request`,
      );
      assert.equal(await thread.locator("[data-assistant-working]").count(), 0);
    }

    await page.keyboard.press("Escape");
    await thread.waitFor({ state: "detached" });
    await page.evaluate(() =>
      window.capture.getState().patch({ localId: crypto.randomUUID() }),
    );
    await page.waitForFunction(
      () => window.assistantThread.getState().items.length === 0,
    );
    await orb.click();
    assert.equal(
      await thread.count(),
      0,
      `${label}: a new project starts without the old thread`,
    );
    assert.equal(await field.count(), 1);
    assert.equal(
      calls.length,
      variant === "phone" ? 3 : 2,
      `${label}: reopening never resubmits a request`,
    );
    assert.deepEqual(errors, [], `${label}: no page errors`);
    console.log(
      `Assistant thread passed on ${label}: native answer/edit, history guards, session reset and layout.`,
    );
  } finally {
    releasePending();
    await context.close();
  }
}

try {
  await run("desktop", 1440, 900);
  await run("phone", 390, 844);
  await run("phone", 320, 693);
} finally {
  await browser.close();
}
