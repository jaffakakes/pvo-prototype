import assert from "node:assert/strict";
import { join, parse } from "node:path";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { finishAssistantVerification } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const cases = [
  { width: 320, height: 568 }, { width: 390, height: 844 },
  { width: 430, height: 932 }, { width: 740, height: 430 },
  { width: 1024, height: 768 }, { width: 1440, height: 900 },
];
const answerText = "This edit contains one twelve-second clip. You can add text, trim footage, or adjust its sound. ".repeat(12);

function inside(actual, region, message) {
  assert(actual && region && actual.x >= region.x - 1 && actual.y >= region.y - 1
    && actual.x + actual.width <= region.x + region.width + 1
    && actual.y + actual.height <= region.y + region.height + 1,
  `${message}: ${JSON.stringify({ actual, region })}`);
}

function apart(left, right, message) {
  assert(left && right && (left.x + left.width <= right.x + 1 || right.x + right.width <= left.x + 1
    || left.y + left.height <= right.y + 1 || right.y + right.height <= left.y + 1), message);
}

async function run(viewport) {
  const desktop = viewport.width >= 1024;
  const label = `${desktop ? "desktop" : "mobile"}-${viewport.width}x${viewport.height}`;
  const context = await browser.newContext({ viewport, hasTouch: !desktop, reducedMotion: "reduce" });
  const pending = [];
  const verificationRequests = [];
  await context.route("**/api/assistant/turn", async route => {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    if (await finishAssistantVerification(route, request)) {
      verificationRequests.push(request);
      return;
    }
    const response = pending.shift();
    assert(response, `${label}: every provider request must be explicitly exercised`);
    await response.ready;
    await route.fulfill({ status: response.status, json: typeof response.body === "function" ? response.body(request) : response.body });
  });
  const queue = (body, status = 200) => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    pending.push({ body, status, ready });
    return release;
  };
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  const orb = page.locator("[data-assistant-orb]");
  const field = page.getByRole("textbox", { name: "Describe a change", exact: true });
  const phase = name => page.locator(`[data-assistant-phase="${name}"]`);
  const toolbar = desktop ? page.getByRole("toolbar", { name: "Timeline editing", exact: true }) : page.locator(".toolBar");
  const answer = page.locator("[data-assistant-review]");
  const snapshot = () => page.evaluate(() => {
    const state = window.capture.getState();
    return { scenes: state.scenes, ratio: state.ratio, past: state.past.length, future: state.future.length };
  });
  const screenshot = async suffix => {
    if (!process.env.PVO_ASSISTANT_SCREENSHOT) return;
    const { dir, name, ext } = parse(process.env.PVO_ASSISTANT_SCREENSHOT);
    await page.screenshot({ path: join(dir, `${name}-${label}-${suffix}${ext || ".png"}`) });
  };
  const submit = async text => {
    await field.fill(text);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await phase("working").waitFor();
  };
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    `${label}: the assistant must never widen the page`);

  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#create-title, .camWrap").first().waitFor();
    await page.evaluate(async () => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      const { resetAssistant } = await import("/src/state/assistant/assistantStore.ts");
      useCapture.setState(initial());
      resetAssistant();
      window.capture = useCapture;
      useCapture.getState().patch({ screen: "editor", clips: [mkClip(12, null, 0)],
        sound: -1, muted: true, t: 2, playing: false, sel: -1 });
    });
    await phase("idle").waitFor();
    const original = await snapshot();
    const toolbarBefore = await toolbar.boundingBox();
    const previewBefore = await page.locator(".previewArea").boundingBox();
    const idleOrb = await orb.boundingBox();
    assert.equal(idleOrb.width, desktop ? 46 : 58, `${label}: handoff orb diameter`);
    assert.equal(idleOrb.height, desktop ? 46 : 58);
    assert.equal(toolbarBefore.height, desktop ? 54 : 100, `${label}: reserved toolbar height`);
    assert.equal(await orb.locator("img").evaluate(element => getComputedStyle(element).opacity), desktop ? "0.5" : "0.45");
    await screenshot("idle");
    await orb.click();
    await field.waitFor();
    assert.equal(await field.count(), 1, "One request box routes every kind of task");
    assert.deepEqual(await toolbar.boundingBox(), toolbarBefore, `${label}: typing retains toolbar geometry`);
    assert.deepEqual(await page.locator(".previewArea").boundingBox(), previewBefore, `${label}: typing retains preview geometry`);
    assert.equal(await page.locator("[data-assistant-dim]").count(), 0);
    const activeOrb = await orb.boundingBox();
    assert.equal(await orb.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 45, 120)");
    assert.equal(await orb.locator("img").evaluate(element => getComputedStyle(element).opacity), "1");
    if (desktop) {
      inside(await page.locator("[data-assistant-composer]").boundingBox(), toolbarBefore, `${label}: inline request field`);
      assert.equal((await field.boundingBox()).height, 32);
      assert.deepEqual(activeOrb, idleOrb, `${label}: the orb remains docked while typing`);
      apart(await page.getByRole("button", { name: "Zoom timeline in", exact: true }).boundingBox(),
        await page.locator("[data-assistant-composer]").boundingBox(), `${label}: the request field must not cover zoom`);
    } else {
      assert(Math.abs(activeOrb.x - toolbarBefore.x - 14) <= 1, `${label}: typing orb sits left`);
      assert(Math.abs(activeOrb.y - idleOrb.y + 8) <= 1, `${label}: awake orb lifts eight pixels`);
      assert.match(await page.locator("[data-assistant-context]").innerText(), /Whole edit.*1 clip.*0:12/s);
      const quick = page.getByLabel("Whole edit suggestions", { exact: true });
      assert.equal(await quick.getByRole("button").count(), 3);
      inside(await quick.boundingBox(), toolbarBefore, `${label}: whole-edit shortcuts fit the toolbar`);
      apart(await quick.boundingBox(), await page.locator("[data-assistant-composer]").boundingBox(), `${label}: shortcuts cannot overlap the request field`);
      assert.equal(await toolbar.locator(".tools button").count(), 0);
    }
    await noOverflow();
    await screenshot("typing");

    const composerBeforeRequest = await page.locator("[data-assistant-composer]").boundingBox();
    const releaseAnswer = queue({ message: answerText, operations: [], observations: [] });
    await submit("Describe this project");
    const heading = page.locator("[data-assistant-live-heading]");
    assert.equal((await heading.innerText()).toLowerCase(), "reading your project…", `${label}: real workflow stage stays visible while inference is pending`);
    assert.equal(await heading.getAttribute("role"), "status");
    assert.equal(await field.count(), 0, `${label}: working has no second request field`);
    assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Stop request", exact: true }).getByText("Stop", { exact: true }).waitFor();
    if (desktop) {
      const pill = await page.locator("[data-assistant-live]").boundingBox();
      inside(pill, toolbarBefore, `${label}: working pill belongs in the toolbar`);
      assert.equal(pill.height, 32);
      assert(Math.abs(pill.width - composerBeforeRequest.width) <= 1, `${label}: working keeps the request field width`);
      apart(pill, await orb.boundingBox(), `${label}: working pill clears the orb`);
      assert.equal(await page.locator("[data-assistant-live]").evaluate(element => getComputedStyle(element, "::after").display), "none");
    } else {
      const workingOrb = await orb.boundingBox();
      assert(Math.abs(workingOrb.x - idleOrb.x) <= 1, `${label}: working returns to the right`);
      assert(Math.abs(workingOrb.y - idleOrb.y + 8) <= 1);
    }
    assert.deepEqual(await snapshot(), original, `${label}: an unfinished request cannot mutate the project`);
    assert.deepEqual(await phase("working").evaluate(element => element.getAnimations({ subtree: true }).map(animation => animation.playState)), [],
      `${label}: reduced motion suppresses breathing, pulses and glides`);
    await screenshot("working");
    releaseAnswer();
    await answer.waitFor();
    assert.equal(await answer.getAttribute("aria-label"), "Assistant answer");
    inside(await answer.boundingBox(), { x: 0, y: 0, ...viewport }, `${label}: a long answer stays in the viewport`);
    await answer.getByRole("button", { name: "Done", exact: true }).click({ trial: true });
    assert.equal(await answer.getByRole("button", { name: /^(Keep|Before|Undo)$/ }).count(), 0,
      "An answer must not offer edit confirmation controls");
    assert.deepEqual(await snapshot(), original, `${label}: answering leaves history untouched`);
    await noOverflow();
    await screenshot("answer");
    await answer.getByRole("button", { name: "Done", exact: true }).click();
    await phase("idle").waitFor();
    await orb.click();
    const releaseEdit = queue(request => ({ message: "Added the title and lowered the clip sound.", observations: [], operations: [
      { kind: "text.add", sceneId: request.project.currentSceneId, text: "Golden hour", start: 1, end: 5 },
      { kind: "scene.update", sceneId: request.project.currentSceneId, changes: { clipGain: .25 } },
    ] }));
    await submit("Add a title and lower the clip sound");
    releaseEdit();
    const notice = page.locator('[data-notification-id="assistantApplied"]');
    await notice.waitFor();
    await notice.hover();
    await phase("idle").waitFor();
    const applied = await snapshot();
    assert.equal(applied.scenes[0].texts[0].text, "Golden hour");
    assert.equal(applied.scenes[0].clipGain, .25);
    assert.equal(applied.past, original.past + 1, `${label}: the whole native edit is one history step`);
    assert.equal(await page.getByRole("button", { name: "Keep", exact: true }).count(), 0);
    assert.equal(await page.locator("[data-assistant-projection]").count(), 0, "Applied edits render directly from project state");
    await screenshot("applied");
    await notice.getByRole("button", { name: "Undo", exact: true }).click();
    const undone = await snapshot();
    assert.deepEqual(undone.scenes, original.scenes, `${label}: toast Undo restores the full project`);
    assert.equal(undone.past, original.past);
    assert.equal(undone.future, 1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.waitForFunction(() => window.capture.getState().texts.length === 1);
    assert.deepEqual((await snapshot()).scenes, applied.scenes, `${label}: Redo restores the whole native edit`);
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForFunction(() => window.capture.getState().texts.length === 0);

    if (viewport.width === 430) {
      await page.evaluate(() => {
        window.capture.getState().addComponent("card");
        window.capture.getState().patch({ sheet: null, past: [], future: [] });
      });
      await orb.click();
      const mini = await page.locator("[data-assistant-context-preview]").boundingBox();
      assert.equal(mini.width, 22);
      assert.equal(mini.height, 32);
      assert.match(await page.locator("[data-assistant-context]").innerText(), /Card.*0:0\d/s);
      inside(await field.boundingBox(), await toolbar.boundingBox(), "Selected-component input stays in the toolbar");
      const beforeFailure = await snapshot();
      for (const [status, prompt, id] of [[422, "Build a dashboard", "assistantUnsupported"], [503, "Make it blue", "assistantUnavailable"]]) {
        // These independent provider failures do not exercise the global notification rate limiter.
        await page.evaluate(async () => {
          const { resetNotifications, setNotificationsBusy, useNotifications } = await import("/src/state/notifications/notificationStore.ts");
          const busy = useNotifications.getState().busy;
          resetNotifications();
          setNotificationsBusy(busy);
        });
        const releaseFailure = queue({ error: { message: "Untrusted provider detail must stay hidden." } }, status);
        await submit(prompt);
        releaseFailure();
        await phase("typing").waitFor();
        const failure = page.locator(`[data-notification-id="${id}"]`);
        await failure.waitFor();
        assert.equal(await field.inputValue(), prompt, "Provider failure preserves the request");
        assert.deepEqual(await snapshot(), beforeFailure, "Provider failure cannot apply a preset or partial edit");
        assert.equal(await page.getByText("Untrusted provider detail must stay hidden.", { exact: true }).count(), 0);
        await failure.getByRole("button", { name: "Dismiss notification", exact: true }).click();
      }
      await field.press("Escape");
      await phase("idle").waitFor();
      for (const selector of [".previewArea", ".transport", ".editorHead"]) {
        await orb.click();
        await field.waitFor();
        const bounds = await page.locator(selector).boundingBox();
        await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await phase("idle").waitFor();
      }
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
      await orb.click();
      await field.waitFor();
      assert((await orb.boundingBox()).y + 58 <= viewport.height - 34 + 1, "Awake orb clears the phone safe area");
      await noOverflow();
      await cdp.detach();
    }
    assert.equal(pending.length, 0);
    assert.equal(verificationRequests.length, 1, `${label}: one edit workflow confirms its prepared candidate`);
    assert.deepEqual(errors, []);
    console.log(`Orb handoff passed: ${label}.`);
  } catch (error) {
    console.error(`${label}: ${(await page.locator("body").innerText()).slice(0, 2000)}`);
    await screenshot("failure").catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  for (const viewport of cases) await run(viewport);
  console.log("Orb assistant passed: handoff geometry, whole/component context, one automatic request field, long answers, atomic autoapply, toast Undo/Redo, failure preservation, dismissal, safe areas and reduced motion.");
} finally { await browser.close(); }
