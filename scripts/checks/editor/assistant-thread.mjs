import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const errors = [];

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const state = window.capture.getState();
    return JSON.parse(JSON.stringify({ component: state.components[0], past: state.past.length,
      selected: state.selComp, time: state.t, playing: state.playing }));
  });
}

async function mobileGeometry(page) {
  return page.evaluate(() => {
    const bounds = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    return { workspace: bounds(".editorWorkspace"), header: bounds(".editorHead"), transport: bounds(".transport"),
      dock: bounds(".editorDock"), preview: bounds(".previewArea"),
      composer: bounds("[data-thread-compose]"), orb: bounds("[data-assistant-orb]") };
  });
}

try {
  for (const [variant, width, height] of [["desktop", 1440, 1000], ["phone", 430, 932], ["phone", 390, 844], ["phone", 320, 693]]) {
    const label = variant === "desktop" || width === 430 ? variant : `${variant}-${width}`;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: variant === "phone" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(`${variant}: ${error.message}`));
    let releaseResponse;
    let requestCount = 0;
    await page.route("**/api/assistant", async route => {
      const request = route.request().postDataJSON();
      requestCount++;
      await new Promise(resolve => { releaseResponse = resolve; });
      const style = request.prompt.includes("heading")
        ? "title { font-size: 28px; font-weight: 800; }"
        : "card { border-radius: 14px; background: #30263F; }";
      await route.fulfill({ json: {
        source: { ...request.source, style: `${request.source.style}\n${style}` },
        summary: request.prompt.includes("heading")
          ? "Made the heading larger and easier to read."
          : "Softened the card corners and gave it a warmer background.",
        tags: ["Style"], followUps: ["Softer colours", "Larger heading", "Bolder"],
      } });
    });
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      await page.locator("#restyle-launch-splash").waitFor({ state: "hidden" });
      await page.evaluate(async root => {
        const { useCapture, mkClip } = await import("/src/store.ts");
        window.capture = useCapture;
        const { resetAssistantThread } = await import("/src/state/assistant/threadStore.ts");
        const { useEditorPreferences } = await import("/src/state/preferences/editorPreferences.ts");
        useEditorPreferences.setState({ advancedEditingEnabled: false });
        const media = await fetch(`/@fs/${root}share/assets/preview.mp4`).then(response => response.blob());
        const clips = [mkClip(15, URL.createObjectURL(media), 0)];
        useCapture.setState({
          scenes: [{ id: "main", name: "Launch story", clips, texts: [], components: [], layers: ["video"], muted: true, sound: -1 }],
          currentSceneId: "main", clips, texts: [], components: [], layers: ["video"], screen: "editor",
          sheet: null, sel: -1, selComp: null, selText: null, t: 2, past: [], future: [], playing: false, tryMode: null,
        });
        const id = useCapture.getState().addComponent("card");
        const component = useCapture.getState().components.find(item => item.id === id);
        useCapture.getState().updateComponent(id, { fields: { ...component.fields,
          title: "A brighter launch", body: "A little detail can change the whole story." } });
        useCapture.getState().patch({ sheet: null, t: 2 });
        resetAssistantThread();
      }, root);
      const orb = page.locator("[data-assistant-orb]");
      const thread = page.getByRole("dialog", { name: "Restyle thread", exact: true });
      const field = thread.getByRole("textbox", { name: "Describe a change", exact: true });
      const review = page.getByRole("region", { name: "Review assistant change", exact: true });
      const rows = thread.locator("[data-exchange-id]");
      const open = async () => {
        await settle(page);
        if (!await thread.isVisible()) {
          const box = await orb.boundingBox();
          assert(box, "The orb is available to open the thread");
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        await thread.waitFor();
        await settle(page);
      };
      const close = async () => {
        await thread.getByRole("button", { name: "Close Restyle thread", exact: true }).click();
        await thread.waitFor({ state: "detached" });
        await settle(page);
      };
      const sendAndKeep = async (words, inspectPending = false) => {
        await open();
        const before = await snapshot(page);
        await field.fill(words);
        await field.press("Enter");
        await thread.locator('[data-exchange-status="pending"]').waitFor();
        await thread.getByText("Working on it…", { exact: true }).waitFor();
        if (inspectPending) {
          await close();
          await open();
          assert.equal(await thread.locator('[data-exchange-status="pending"]').count(), 1,
            "Closing and reopening preserves the in-flight exchange");
        }
        await page.waitForFunction(() => !!document.querySelector('[data-assistant-phase="working"]'));
        for (let attempt = 0; !releaseResponse && attempt < 150; attempt++) await page.waitForTimeout(100);
        assert(releaseResponse, "The pending exchange reaches the assistant HTTP service");
        const release = releaseResponse;
        releaseResponse = null;
        release();
        await review.waitFor();
        assert.equal(await thread.count(), 0, "The existing component review replaces the thread");
        assert.deepEqual((await snapshot(page)).component, before.component, "A proposal remains read-only until Keep");
        await review.getByRole("button", { name: "Keep", exact: true }).click();
        await review.waitFor({ state: "detached" });
        await open();
        assert.equal(await rows.filter({ hasText: words }).getAttribute("data-exchange-status"), "applied");
        assert.equal((await snapshot(page)).past, before.past + 1, "Keep is one project-history edit");
      };

      await orb.waitFor();
      await settle(page);
      await page.evaluate(() => window.capture.getState().patch({ playing: true }));
      await open();
      assert.equal((await snapshot(page)).playing, false, "Opening the thread pauses playback");
      const initial = await snapshot(page);
      await close();
      assert.equal((await snapshot(page)).selected, initial.selected);
      assert.equal((await snapshot(page)).time, initial.time);
      assert.equal((await snapshot(page)).playing, false, "Closing keeps playback paused");
      await sendAndKeep("Make the heading larger");
      const first = await snapshot(page);
      await sendAndKeep("Soften the card corners", true);
      const kept = await snapshot(page);
      assert.equal(await rows.count(), 2);
      assert.equal(requestCount, 2, "Reopening a pending exchange never resubmits it");

      await page.evaluate(() => {
        const state = window.capture.getState();
        state.updateComponent(state.components[0].id, { x: 62, y: 39 }, true);
      });
      const latest = rows.filter({ hasText: "Soften the card corners" });
      await latest.getByRole("button", { name: "Undo", exact: true }).click();
      let current = await snapshot(page);
      assert.deepEqual(current.component.code, first.component.code, "Exchange Undo only reverts its own code change");
      assert.equal(current.component.x, 62);
      assert.equal(current.component.y, 39);
      assert.equal(await latest.getAttribute("data-undone"), "true");
      await latest.getByRole("button", { name: "Redo", exact: true }).click();
      current = await snapshot(page);
      assert.deepEqual(current.component.code, kept.component.code);
      assert.equal(current.component.x, 62, "Redo preserves the later position edit");
      await close();
      await page.evaluate(() => window.capture.getState().patch({ selComp: null, t: 0 }));
      await open();
      await latest.getByRole("button", { name: "Show", exact: true }).click();
      await thread.waitFor({ state: "detached" });
      assert.equal((await snapshot(page)).selected, kept.component.id);
      assert.equal((await snapshot(page)).time, kept.component.at);
      await open();
      await thread.getByRole("button", { name: "Collapse", exact: true }).click();
      assert.equal(await rows.count(), 1);
      await page.keyboard.press("Escape");
      await thread.waitFor({ state: "detached" });
      assert.equal(await orb.evaluate(element => element === document.activeElement), true, "Close returns focus to the orb");
      await open();
      assert.equal(await thread.getAttribute("data-collapsed"), "true", "Collapse survives close/reopen");
      await thread.getByRole("button", { name: "Show 1 earlier", exact: true }).click();
      await settle(page);
      assert.equal(await rows.count(), 2);

      if (variant === "desktop") {
        const bounds = await thread.boundingBox();
        assert.equal(Math.round(bounds.width), 440);
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.y + bounds.height <= height);
        const selection = await snapshot(page);
        await page.mouse.click(12, 120);
        await thread.waitFor({ state: "detached" });
        assert.equal((await snapshot(page)).selected, selection.selected, "Outside dismissal keeps selection");
        await open();
      } else {
        const selection = await snapshot(page);
        await page.mouse.click(12, 120);
        await thread.waitFor({ state: "detached" });
        assert.equal((await snapshot(page)).selected, selection.selected, "Closing the phone thread outside keeps selection");
        await open();
        const geometry = await mobileGeometry(page);
        const maximum = geometry.workspace.height - geometry.header.height - geometry.transport.height - 190;
        assert.equal(Math.round(geometry.dock.height), Math.round(Math.min(480, maximum)));
        assert(geometry.preview.height >= 190);
        assert(Math.abs(geometry.orb.y - (geometry.dock.y - 30)) <= 2, "The orb rides the sheet edge");
        const pausedStatus = page.getByText("Paused · orb open", { exact: true });
        await pausedStatus.waitFor();
        const statusBox = await pausedStatus.boundingBox();
        assert(statusBox && (statusBox.x + statusBox.width <= geometry.orb.x || statusBox.y + statusBox.height <= geometry.orb.y),
          "The transport's thread status remains clear of the floating orb");
        const handle = page.getByRole("separator", { name: "Resize Restyle thread", exact: true });
        await handle.focus();
        await page.keyboard.press("ArrowDown");
        await settle(page);
        const beforeKeyboard = await mobileGeometry(page);
        assert.equal(Math.round(beforeKeyboard.dock.height), Math.round(geometry.dock.height - 40));
        await field.focus();
        await page.evaluate(() => {
          Object.defineProperty(window.visualViewport, "height", { configurable: true, value: innerHeight - 236 });
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.locator('.editorWorkspace[data-keyboard-open="true"]').waitFor();
        await settle(page);
        const keyboard = await mobileGeometry(page);
        assert(keyboard.preview.height >= 190);
        assert(keyboard.composer.bottom <= height - 236 + 1, "The composer remains above the OS keyboard");
        assert.equal(await rows.count(), 1, "The keyboard temporarily shows only the newest exchange");
        await thread.getByRole("button", { name: "Show 1 earlier", exact: true }).click();
        assert.equal(await rows.count(), 2, "Show earlier remains available with the keyboard open");
        await field.evaluate(element => element.blur());
        await page.evaluate(() => {
          delete window.visualViewport.height;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.locator('.editorWorkspace[data-keyboard-open="false"]').waitFor();
        await settle(page);
        assert(Math.abs((await mobileGeometry(page)).dock.height - beforeKeyboard.dock.height) < 2,
          "Keyboard dismissal restores the user's chosen sheet height");
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, height - 24, { steps: 12 });
        await page.mouse.up();
        await thread.waitFor({ state: "detached" });
        await open();
      }
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      await page.screenshot({ path: `/tmp/pvo-orb-thread-${label}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`Assistant thread passed on ${label}: real compile/Keep, pending reopen, independent Undo/Redo, Show and collapse${variant === "phone" ? ", dock resizing and simulated keyboard" : ", outside dismissal"}.`);
    } catch (error) {
      await page.screenshot({ path: `/tmp/pvo-orb-thread-${label}-failure.png` });
      console.error((await page.locator("body").innerText()).slice(-4000));
      console.error(await page.evaluate(async () => {
        const assistant = (await import("/src/state/assistant/assistantStore.ts")).useAssistant.getState();
        const thread = (await import("/src/state/assistant/threadStore.ts")).useAssistantThread.getState();
        return { phase: assistant.phase, open: thread.open,
          items: thread.items.map(item => ({ request: item.you, status: item.status })),
          selected: window.capture.getState().selComp, sheet: window.capture.getState().sheet };
      }));
      throw error;
    } finally {
      releaseResponse?.();
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
