import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// Prerequisites: a running editor and Chrome (or CHROME_PATH).
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  isMobile: true,
  hasTouch: true,
  permissions: [],
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

async function assertSourceMatches(area, mirror) {
  const source = await area.inputValue();
  assert.equal(await mirror.locator("[data-token]").allTextContents().then(parts => parts.join("")), source,
    "Highlighting must preserve the source exactly, including unfinished edits");
}

async function assertScrollAligned(area, mirror, fraction) {
  await area.evaluate((element, position) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * position;
    element.scrollLeft = (element.scrollWidth - element.clientWidth) * position;
    element.dispatchEvent(new Event("scroll"));
  }, fraction);
  const input = await area.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  const output = await mirror.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  assert.ok(input.top > 0 && input.left > 0, "Fixture must scroll in both directions");
  assert.ok(Math.abs(input.top - output.top) <= 1, "Highlighted lines must follow vertical scrolling");
  assert.ok(Math.abs(input.left - output.left) <= 1, "Highlighted characters must follow horizontal scrolling");
}

async function checkCarriageReturnEditing() {
  const fixture = await build({
    stdin: {
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { PvoSourceEditor } from "./editor/src/features/component-authoring/language/PvoSourceEditor";
        function Fixture({ label }) {
          const [value, setValue] = useState("first\\r\\nsecond");
          return <div style={{ height: 200, display: "flex" }}>
            <PvoSourceEditor value={value} part="structure" label={label}
              onChange={setValue} expanded={false} onExpand={() => {}} />
          </div>;
        }
        createRoot(document.getElementById("fixture")).render(<>
          <Fixture label="CRLF caret" /><Fixture label="CRLF selection" />
        </>);
      `,
      resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
      loader: "tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", outfile: "fixture.js",
  });
  const fixturePage = await browser.newPage();
  try {
    await fixturePage.setContent('<!doctype html><div id="fixture"></div>');
    for (const output of fixture.outputFiles) {
      if (output.path.endsWith(".css")) await fixturePage.addStyleTag({ content: output.text });
      else await fixturePage.addScriptTag({ content: output.text });
    }
    const caret = fixturePage.getByRole("textbox", { name: "CRLF caret" });
    await caret.focus();
    await caret.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
    await caret.press("Tab");
    assert.equal(await caret.inputValue(), "first\nsecond  ", "Loaded CRLF must use native caret offsets");
    const selection = fixturePage.getByRole("textbox", { name: "CRLF selection" });
    await selection.focus();
    await selection.evaluate(element => element.setSelectionRange(6, 12));
    await selection.press("Tab");
    assert.equal(await selection.inputValue(), "first\n  ", "CRLF selection replacement must preserve neighboring text");
    assert.deepEqual(await selection.evaluate(element => [element.selectionStart, element.selectionEnd]), [8, 8]);
  } finally {
    await fixturePage.close();
  }
}

try {
  await checkCarriageReturnEditing();
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visitSite = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visitSite.isVisible()) await visitSite.click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("dialog", { name: "More" });
  await more.getByRole("switch", { name: "Advanced editing", exact: true }).click();
  await more.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  const sheet = page.getByRole("dialog", { name: "Choice" });
  await sheet.getByRole("tab", { name: "Advanced" }).click();
  const frame = sheet.locator("[data-pvo-source-editor]");
  const mirror = frame.locator("[data-pvo-highlight]");

  for (const [part, kinds] of [
    ["Structure", ["tag", "attribute", "string", "template"]],
    ["Style", ["selector", "property", "number"]],
    ["Logic", ["keyword", "function"]],
  ]) {
    await sheet.getByRole("tab", { name: part, exact: true }).click();
    const area = sheet.getByRole("textbox", { name: `${part} source` });
    await assertSourceMatches(area, mirror);
    const colours = [];
    for (const kind of kinds) {
      const token = mirror.locator(`[data-token="${kind}"]`).first();
      assert.ok(await token.count(), `${part} needs ${kind} highlighting`);
      colours.push(await token.evaluate(element => getComputedStyle(element).color));
    }
    assert.equal(new Set(colours).size, kinds.length, `${part} token categories need distinct colours`);
    assert.equal(await mirror.getAttribute("aria-hidden"), "true", "Only the native editor should be exposed to assistive technology");
    assert.equal(await area.evaluate(element => getComputedStyle(element).fontSize), "16px", "Phone typing must not trigger iOS small-text zoom");
  }

  await sheet.getByRole("tab", { name: "Structure", exact: true }).click();
  const area = sheet.getByRole("textbox", { name: "Structure source" });
  const starter = await area.inputValue();
  await area.focus();
  await area.evaluate(element => element.setSelectionRange(1, 4));
  await area.press("Tab");
  assert.equal(await area.inputValue(), starter.slice(0, 1) + "  " + starter.slice(4));
  assert.deepEqual(await area.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 3]);
  await area.press("Shift+Tab");
  assert.equal(await area.evaluate(element => document.activeElement === element), false, "Keyboard users must be able to leave the editor");
  await area.fill('<choice><prompt>&lt;img onerror="alert(1)"&gt; 😀</prompt><option id="unfinished');
  await assertSourceMatches(area, mirror);
  assert.equal(await mirror.locator("img,script,option").count(), 0, "Source text must never become executable markup");

  const longSource = Array.from({ length: 40 }, (_, index) => `<prompt>Line ${index}: ${"long value ".repeat(30)}</prompt>`).join("\n") + "\n";
  await area.fill(longSource);
  await assertSourceMatches(area, mirror);
  await assertScrollAligned(area, mirror, 0.5);
  await assertScrollAligned(area, mirror, 1);
  await sheet.getByRole("button", { name: "Expand language editor" }).click();
  await assertScrollAligned(area, mirror, 1);
  await sheet.getByRole("tab", { name: "Style", exact: true }).click();
  assert.deepEqual(await mirror.evaluate(element => [element.scrollTop, element.scrollLeft]), [0, 0], "Switching sections resets the viewport");
  await sheet.getByRole("tab", { name: "Structure", exact: true }).click();
  await area.fill(starter);
  await sheet.getByRole("status").getByText(/Valid · preview updated/).waitFor();
  if (process.env.PVO_HIGHLIGHT_SCREENSHOT) await page.screenshot({ path: process.env.PVO_HIGHLIGHT_SCREENSHOT });

  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await area.evaluate(element => getComputedStyle(element).fontSize), "11.5px");
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await mirror.evaluate(element => getComputedStyle(element).display), "none");
  assert.notEqual(await area.evaluate(element => getComputedStyle(element).webkitTextFillColor), "rgba(0, 0, 0, 0)",
    "High contrast mode must expose readable native text");
  assert.deepEqual(errors, []);
  console.log("PVO highlighting passed: colours, exact source, safe markup, mobile text, keyboard/CRLF selection, scrolling and high contrast.");
} catch (error) {
  console.error(`PVO highlighting failed: ${error.stack}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
