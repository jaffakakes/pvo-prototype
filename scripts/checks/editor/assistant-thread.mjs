import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { finishAssistantVerification, installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_PATH || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });

const answerPrompt = "Describe this edit";
const editPrompt = "Add a short title";
const pendingPrompt = "Hold this request";
const answerText = "This edit has one twelve-second clip.";

async function state(page) {
  return page.evaluate(() => {
    const capture = window.capture.getState();
    return { texts: capture.texts.map(item => item.text), past: capture.past.length,
      future: capture.future.length, localId: capture.localId };
  });
}

async function assertNoOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    `${label}: thread must not widen the page`);
}

async function phoneGeometry(page) {
  return page.evaluate(() => {
    const bounds = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    return { dock: bounds(".editorDock"), preview: bounds(".previewArea"),
      composer: bounds("[data-thread-compose]") };
  });
}

async function settleLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function run(variant, width, height) {
  const label = `${variant}-${width}x${height}`;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: variant === "phone",
    reducedMotion: "reduce" });
  await installAssistantAvailabilityFixture(context);
  const calls = [];
  let releasePending;
  const pendingGate = new Promise(resolve => { releasePending = resolve; });
  await context.route("**/api/assistant/turn", async route => {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    assert.equal(request.mode, "plan", `${label}: native planner must handle each thread request`);
    if (await finishAssistantVerification(route, request)) return;
    calls.push(request);
    if (request.prompt === answerPrompt) {
      await route.fulfill({ json: parseNativeTurnResult({ message: answerText,
        operations: [], observations: [] }) });
      return;
    }
    if (request.prompt === pendingPrompt) {
      await pendingGate;
      try {
        await route.fulfill({ json: parseNativeTurnResult({ message: "No change made.",
          operations: [], observations: [] }) });
      } catch (error) {
        if (!/closed|cancel|Invalid Interception/i.test(String(error))) throw error;
      }
      return;
    }
    assert.equal(request.prompt, editPrompt, `${label}: unexpected assistant request`);
    await route.fulfill({ json: parseNativeTurnResult({ message: "Preparing a title.", operations: [
      { kind: "text.add", sceneId: "main", text: "A fresh start", start: 1, end: 3 },
    ], observations: [] }) });
  });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const orb = page.locator("[data-assistant-orb]");
  const thread = page.locator("[data-assistant-thread]");
  const field = page.getByRole("textbox", { name: "Describe a change", exact: true });
  const send = page.getByRole("button", { name: "Send request", exact: true });

  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#create-title, .camWrap").first().waitFor();
    await page.evaluate(async () => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      const { resetAssistant } = await import("/src/state/assistant/assistantStore.ts");
      const { resetAssistantThread, useAssistantThread } = await import("/src/state/assistant/threadStore.ts");
      useCapture.setState(initial());
      resetAssistant();
      useCapture.getState().patch({ screen: "editor", localId: crypto.randomUUID(),
        clips: [mkClip(12, null, 0)], sound: -1, muted: true, t: 2,
        playing: false, sel: -1, selComp: null, selText: null });
      resetAssistantThread();
      window.capture = useCapture;
      window.assistantThread = useAssistantThread;
    });
    await orb.waitFor();

    // The first request uses the native composer and produces a read-only answer.
    await orb.click();
    assert.equal(await field.count(), 1, `${label}: one composer when the thread is empty`);
    await field.fill(answerPrompt);
    await send.click();
    const answer = page.locator("[data-assistant-review]");
    await answer.getByText(answerText, { exact: true }).waitFor();
    assert.equal((await state(page)).past, 0, `${label}: an answer is not a project edit`);
    await answer.getByRole("button", { name: "Done", exact: true }).click();

    // The separate count button reveals earlier exchanges without changing orb tap behavior.
    await page.getByRole("button", { name: "Open Restyle thread, 1 exchange" }).click();
    await thread.waitFor();
    assert.equal(await field.count(), 1, `${label}: one composer when the thread is open`);
    assert.equal(await thread.locator('[data-exchange-status="answered"]').count(), 1);
    assert.equal(await thread.getByText(answerPrompt, { exact: true }).count(), 1);
    await field.fill(editPrompt);
    await send.click();
    await page.locator('[data-notification-id="assistantApplied"]').waitFor();
    assert.deepEqual((await state(page)).texts, ["A fresh start"], `${label}: native batch applies once`);
    assert.equal((await state(page)).past, 1);

    await thread.waitFor();
    const applied = thread.locator('[data-exchange-status="applied"]');
    await applied.waitFor();
    assert.equal(await thread.locator('[data-exchange-status="answered"]').count(), 1);
    if (await field.count() === 0) await orb.click();
    assert.equal(await field.count(), 1, `${label}: the thread offers one composer after applying an edit`);
    await applied.getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual((await state(page)).texts, [], `${label}: row Undo reverts its edit`);
    assert.equal(await applied.getAttribute("data-undone"), "true");
    await applied.getByRole("button", { name: "Redo", exact: true }).click();
    assert.deepEqual((await state(page)).texts, ["A fresh start"], `${label}: row Redo restores its edit`);

    await page.evaluate(() => window.capture.getState().addText("A later manual edit"));
    assert.equal(await applied.getByRole("button", { name: "Undo", exact: true }).isDisabled(), true,
      `${label}: an older exchange cannot consume a later history step`);
    await assertNoOverflow(page, label);

    if (variant === "phone") {
      const geometry = await phoneGeometry(page);
      assert(geometry.preview.height >= 190, `${label}: the player remains visible above the thread`);
      assert(geometry.dock.height > 0 && geometry.composer.bottom <= height + 1,
        `${label}: the thread composer fits in the phone viewport`);

      const handle = page.getByRole("separator", { name: "Resize Restyle thread", exact: true });
      await handle.focus();
      await page.keyboard.press("ArrowDown");
      await settleLayout(page);
      const resized = await phoneGeometry(page);
      assert.equal(Math.round(resized.dock.height), Math.round(geometry.dock.height - 40),
        `${label}: keyboard resize changes the preferred dock height`);

      await field.focus();
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "height", { configurable: true, value: innerHeight - 236 });
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await page.locator('.editorWorkspace[data-keyboard-open="true"]').waitFor();
      await settleLayout(page);
      const keyboard = await phoneGeometry(page);
      assert(keyboard.preview.height >= 190, `${label}: footage stays usable with the keyboard open`);
      assert(keyboard.composer.bottom <= height - 236 + 1,
        `${label}: the composer remains above the simulated OS keyboard`);
      assert.equal(await thread.locator("[data-exchange-id]").count(), 1,
        `${label}: the latest exchange fits beside the keyboard`);
      await assertNoOverflow(page, `${label} with keyboard`);

      await field.evaluate(element => element.blur());
      await page.evaluate(() => {
        delete window.visualViewport.height;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await page.locator('.editorWorkspace[data-keyboard-open="false"]').waitFor();
      await settleLayout(page);
      const restored = await phoneGeometry(page);
      assert(Math.abs(restored.dock.height - resized.dock.height) < 2,
        `${label}: keyboard dismissal restores the chosen dock height`);

      // Moving from the phone editor to the desktop editor unmounts the old orb.
      // A request already in flight must leave a cancelled row, not an eternal spinner.
      const pendingRequest = page.waitForRequest(request => request.url().includes("/api/assistant/turn")
        && request.postDataJSON()?.prompt === pendingPrompt);
      await field.fill(pendingPrompt);
      await send.click();
      await pendingRequest;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => window.assistantThread.getState().items.at(-1)?.status === "cancelled");
      releasePending();
      await page.locator("[data-desktop-editor]").waitFor();
      await settleLayout(page);
      await thread.waitFor();
      assert.equal(await thread.locator('[data-exchange-status="cancelled"]').count(), 1,
        `${label}: viewport handoff records the interrupted request`);
    }

    await page.keyboard.press("Escape");
    await thread.waitFor({ state: "detached" });
    await page.evaluate(() => window.capture.getState().patch({ localId: crypto.randomUUID() }));
    await page.waitForFunction(() => window.assistantThread.getState().items.length === 0);
    await orb.click();
    assert.equal(await thread.count(), 0, `${label}: a new project starts without the old thread`);
    assert.equal(await field.count(), 1);
    assert.equal(calls.length, variant === "phone" ? 3 : 2,
      `${label}: reopening never resubmits a request`);
    assert.deepEqual(errors, [], `${label}: no page errors`);
    console.log(`Assistant thread passed on ${label}: native answer/edit, history guards, session reset and layout.`);
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
