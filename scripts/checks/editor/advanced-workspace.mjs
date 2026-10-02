import assert from "node:assert/strict";
import { join, parse } from "node:path";
import { chromium } from "playwright-core";
import { installAssistantFixture } from "./assistant-fixture.mjs";

// Requires Vite and the real PVO compiler. Only the assistant HTTP response is mocked.
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const cases = [
  { width: 320, height: 693 },
  { width: 390, height: 844 },
  { width: 430, height: 932, safeArea: true },
  { width: 1280, height: 800, desktop: true },
  { width: 1440, height: 900, desktop: true },
];
const selectedWidths = process.env.PVO_ADVANCED_WORKSPACE_WIDTHS?.split(",").map(Number);

function inside(actual, expected, message) {
  assert(actual && expected && actual.x >= expected.x - 2 && actual.y >= expected.y - 2
    && actual.x + actual.width <= expected.x + expected.width + 2
    && actual.y + actual.height <= expected.y + expected.height + 2,
  `${message}: ${JSON.stringify({ actual, expected })}`);
}

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function seed(page) {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { setAdvancedEditingEnabled } = await import("/src/state/preferences/editorPreferences.ts");
    const { setComponentAuthoringTab } = await import("/src/state/components/componentAuthoringStore.ts");
    window.capture = useCapture;
    setAdvancedEditingEnabled(true);
    const clips = [mkClip(20, null, 0)];
    const scene = { id: "main", parent: null, name: "Main", clips, texts: [], components: [],
      layers: ["video"], muted: true, sound: -1 };
    useCapture.getState().patch({ scenes: [scene], currentSceneId: "main", clips,
      texts: [], components: [], layers: ["video"], screen: "editor", sheet: null,
      selComp: null, selText: null, sel: -1, t: 2, playing: false, tryMode: null,
      playheadPick: null, past: [], future: [] });
    const id = useCapture.getState().addComponent("card");
    setComponentAuthoringTab(id, "advanced");
  });
  await page.getByLabel("Structure source", { exact: true }).waitFor();
  await settle(page);
}

async function run(testCase) {
  const { width, height, desktop = false, safeArea = false } = testCase;
  const label = `${desktop ? "desktop" : "mobile"}-${width}x${height}`;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: !desktop });
  const provider = await installAssistantFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  const tab = name => page.getByRole("tab", { name, exact: true });
  const button = name => page.getByRole("button", { name, exact: true });
  const panel = page.locator(desktop ? "[data-desktop-inspector]" : ".editorDock");
  const expansion = page.locator(desktop
    ? '[data-desktop-inspector][data-expanded="true"]'
    : '.editorWorkspace[data-code-expanded="true"]');
  const orb = page.locator("[data-assistant-orb]");
  const sourceFrame = page.locator("[data-pvo-source-editor]");
  let cdp;

  async function screenshot(stage) {
    if (!process.env.PVO_ADVANCED_WORKSPACE_SCREENSHOT) return;
    const output = parse(process.env.PVO_ADVANCED_WORKSPACE_SCREENSHOT);
    await page.screenshot({ path: join(output.dir, `${output.name}-${label}-${stage}.png`) });
  }

  async function assertCodeSurface(bounds) {
    const sourceBounds = await sourceFrame.boundingBox();
    assert(sourceBounds && bounds, `${label}: expanded PVO has a visible code surface`);
    const bottomGap = bounds.y + bounds.height - sourceBounds.y - sourceBounds.height;
    assert(bottomGap >= -2 && bottomGap <= 36,
      `${label}: the black code surface extends to the panel bottom without an orb footer (${bottomGap}px gap)`);
    inside(await orb.boundingBox(), sourceBounds, `${label}: the orb floats inside the black code surface`);
    assert.equal(await page.getByText(/Tap.*to shrink/).count(), 0, `${label}: expanded mode has no shrink hint`);
  }

  async function assertExpanded() {
    await expansion.waitFor();
    await settle(page);
    const bounds = await panel.boundingBox();
    assert(bounds);
    if (desktop) {
      assert(Math.abs(bounds.width - width * .8) <= 3, `${label}: expanded width is 80% of the viewport`);
      assert(Math.abs(bounds.height - height * .8) <= 3, `${label}: expanded height is 80% of the viewport`);
      assert(Math.abs(bounds.x + bounds.width / 2 - width / 2) <= 3, `${label}: expanded IDE is horizontally centered`);
      assert(Math.abs(bounds.y + bounds.height / 2 - height / 2) <= 3, `${label}: expanded IDE is vertically centered`);
    } else {
      const usable = await page.locator(".editorWorkspace").evaluate(element => {
        const style = getComputedStyle(element);
        return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      });
      assert(Math.abs(bounds.height - usable * .8) <= 3,
        `${label}: expanded panel uses 80% of safe workspace height (${bounds.height}/${usable})`);
      assert.equal(await page.locator(".transport").isVisible(), false,
        `${label}: expanded code hides Play and the timer`);
      const transportRegion = await page.locator("[data-assistant-playback]").boundingBox();
      assert(!transportRegion || transportRegion.height <= 1,
        `${label}: hidden playback controls reserve no workspace height`);
    }
    assert.equal(await page.locator("[data-component-tabs]:visible").count(), 0,
      `${label}: expanded code hides the Content/Look/Action/Advanced navigation`);
    for (const name of ["Structure", "Style", "Logic"]) assert(await tab(name).isVisible(), `${label}: ${name} remains reachable`);
    assert.equal(await page.locator('[data-placement="floating"]').count(), 1, `${label}: expanded mode has one floating assistant`);
    assert.equal(await orb.count(), 1, `${label}: the normal orb is not duplicated`);
    assert.equal(await orb.evaluate(element => !!element.closest("[inert]")), false,
      `${label}: the floating orb is interactive`);
    const orbShape = await orb.evaluate(element => {
      const box = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      const corners = [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius];
      return { width: box.width, height: box.height,
        radii: corners.map(value => parseFloat(value) * (value.includes("%") ? box.width / 100 : 1)) };
    });
    assert(Math.abs(orbShape.width - orbShape.height) <= 1
      && orbShape.radii.every(radius => radius >= orbShape.width / 2 - 1),
    `${label}: surrounding inspector styles cannot turn the circular orb into a square (${JSON.stringify(orbShape)})`);
    inside(await orb.boundingBox(), bounds, `${label}: the orb stays inside the expanded panel`);
    await assertCodeSurface(bounds);
    if (safeArea) {
      const orbBounds = await orb.boundingBox();
      assert(orbBounds && orbBounds.y + orbBounds.height <= height - 34 + 1,
        `${label}: the orb stays above the phone's bottom safe area`);
    }
    await orb.click({ trial: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    return bounds;
  }

  async function assertCollapsed(original) {
    await expansion.waitFor({ state: "hidden" });
    await settle(page);
    assert.equal(await page.locator('[data-placement="floating"]').count(), 0,
      `${label}: collapsing removes floating placement`);
    assert.equal(await page.locator("[data-component-tabs]:visible").count(), 1);
    const bounds = await panel.boundingBox();
    assert(bounds && Math.abs(bounds.height - original.height) <= 3,
      `${label}: collapse restores the prior panel height (${bounds?.height}/${original.height})`);
    if (!desktop) {
      assert.equal(await orb.count(), 0, `${label}: normal mobile component tools have no floating orb`);
      assert(await page.locator(".transport").isVisible(), `${label}: collapse restores Play and the timer`);
      const transportRegion = await page.locator("[data-assistant-playback]").boundingBox();
      assert(transportRegion && transportRegion.height >= 44, `${label}: restored playback has its usable row height`);
    }
    else assert.equal(await page.locator('[data-placement="toolbar"] [data-assistant-orb]').count(), 1,
      `${label}: desktop restores its existing toolbar orb`);
  }

  try {
    await seed(page);
    if (safeArea) {
      cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
      await settle(page);
    }
    if (!desktop) {
      const handle = page.getByRole("separator", { name: "Resize editing panel", exact: true });
      await handle.focus();
      await handle.press("ArrowUp");
      await settle(page);
    }
    const original = await panel.boundingBox();
    assert(original);
    assert.equal(await page.locator('[data-placement="floating"]').count(), 0);
    const source = page.getByLabel("Structure source", { exact: true });
    const validSource = (await source.inputValue()).replace("New message", "Expanded workspace draft");
    const invalidSource = `${validSource}\n<unfinished`;
    await source.fill(invalidSource);
    await source.evaluate(element => {
      window.advancedSourceElement = element;
      element.setSelectionRange(12, 18);
    });
    await button("Expand language editor").click();
    await assertExpanded();
    assert.equal(await source.evaluate(element => element === window.advancedSourceElement), true,
      `${label}: expansion retains the same mounted source editor`);
    assert.equal(await source.inputValue(), invalidSource, `${label}: expansion preserves an unfinished draft`);
    assert.deepEqual(await source.evaluate(element => [element.selectionStart, element.selectionEnd]), [12, 18],
      `${label}: expansion preserves the caret selection`);
    await button("Collapse language editor").click();
    await assertCollapsed(original);
    assert.equal(await source.evaluate(element => element === window.advancedSourceElement), true);
    assert.equal(await source.inputValue(), invalidSource, `${label}: collapse preserves an unfinished draft`);
    assert.deepEqual(await source.evaluate(element => [element.selectionStart, element.selectionEnd]), [12, 18]);

    await source.fill(validSource);
    await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvoTouched === false);
    await button("Expand language editor").click();
    await assertExpanded();
    await tab("Style").click();
    const style = page.getByLabel("Style source", { exact: true });
    const originalStyle = await style.inputValue();
    const expandedBounds = await panel.boundingBox();
    await orb.click();
    const composer = page.getByRole("textbox", { name: "Describe a change", exact: true });
    await composer.waitFor();
    await settle(page);
    assert.equal(await composer.evaluate(element => document.activeElement === element), true,
      `${label}: the expanded IDE focus scope lets the assistant receive text`);
    assert.equal(await composer.evaluate(element => getComputedStyle(element).fontSize), "16px",
      `${label}: the floating composer retains its readable text size inside the inspector`);
    inside(await composer.boundingBox(), expandedBounds, `${label}: the floating composer stays in the IDE`);
    await screenshot("typing");
    await composer.press("Escape");
    await page.locator('[data-assistant-phase="idle"]').waitFor();
    assert(await expansion.isVisible(), `${label}: Escape closes typing without collapsing the IDE`);
    await orb.click();
    await composer.waitFor();
    await composer.fill("Make it blue");
    await button("Send request").click();
    await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvo?.style.includes("#60A5FA"));
    await page.locator('[data-assistant-phase="idle"]').waitFor();
    const applied = page.locator('[data-notification-id="assistantApplied"]');
    await applied.hover();
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].mode, "plan", "Native operations are prepared as a complete batch before immediate apply");
    assert(await expansion.isVisible(), `${label}: applying an edit keeps the IDE expanded`);
    assert.match(await style.inputValue(), /#60A5FA/, `${label}: the AI edit immediately updates visible PVO source`);
    await applied.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('[aria-label="Style source"]')?.value === expected, originalStyle);
    assert.equal(await style.inputValue(), originalStyle, `${label}: toast Undo restores the previous authored source`);
    await orb.click();
    await composer.fill("Make it blue");
    await button("Send request").click();
    await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvo?.style.includes("#60A5FA"));
    await page.locator('[data-assistant-phase="idle"]').waitFor();
    await page.getByRole("status").filter({ hasText: "Valid · preview updated" }).waitFor();
    await page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Dismiss notification" }).click();
    await settle(page);
    const currentBounds = await panel.boundingBox();
    assert.deepEqual(currentBounds, expandedBounds, `${label}: assistant phases leave IDE geometry stable`);
    await assertCodeSurface(currentBounds);
    await screenshot("expanded");

    if (safeArea || width === 320) {
      const collapse = button("Collapse language editor");
      const safeBounds = await collapse.boundingBox();
      assert(safeBounds && safeBounds.y >= (safeArea ? 59 : 0) && safeBounds.y + safeBounds.height <= height - (safeArea ? 34 : 0),
        "The expansion control remains between real phone safe areas");
      await style.focus();
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "height", { configurable: true, value: innerHeight - 336 });
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await settle(page);
      const keyboardBounds = await style.boundingBox();
      assert(keyboardBounds && keyboardBounds.height >= 64 && keyboardBounds.y >= (safeArea ? 59 : 0)
        && keyboardBounds.y + keyboardBounds.height <= height - 336 + 2,
        `The code surface fits above the simulated keyboard: ${JSON.stringify(keyboardBounds)}`);
      const clippedPoints = await style.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return [rect.top + 3, rect.top + rect.height / 2, rect.bottom - 3].flatMap(y => {
          const hit = document.elementFromPoint(rect.left + 20, y);
          return hit === element ? [] : [{ y, hit: hit?.className ?? null }];
        });
      });
      assert.deepEqual(clippedPoints, [], `${label}: the keyboard cannot clip the code surface behind its ancestors`);
      await assertCodeSurface(await panel.boundingBox());
      await screenshot("keyboard");
      await style.evaluate(element => element.blur());
      await page.evaluate(() => {
        delete window.visualViewport.height;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await assertExpanded();
    }

    await style.focus();
    await page.keyboard.press("Escape");
    await assertCollapsed(original);
    for (const name of ["Content", "Look", "Action"]) {
      await tab(name).click();
      assert.equal(await page.locator('[data-placement="floating"]').count(), 0,
        `${label}: ${name} never uses expanded-code orb placement`);
    }
    assert.deepEqual(errors, [], `${label}: no browser errors`);
    console.log(`Advanced workspace passed: ${label}.`);
  } catch (error) {
    await screenshot("failure").catch(() => {});
    console.error(`${label} UI: ${(await page.locator("body").innerText()).slice(0, 2200)}`);
    throw error;
  } finally {
    await cdp?.detach();
    await context.close();
  }
}

try {
  for (const testCase of cases.filter(testCase => !selectedWidths || selectedWidths.includes(testCase.width))) await run(testCase);
  console.log("Advanced workspace passed: 80% IDE, hidden playback, full-height code with floating AI inside, retained draft/caret/layout, immediate apply/Undo, safe areas and keyboard fitting.");
} finally {
  await browser.close();
}
