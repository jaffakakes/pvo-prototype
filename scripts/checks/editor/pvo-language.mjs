import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Prerequisites: `npm run dev:editor` and Chrome (or CHROME_PATH).
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: [] });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));

try {
  const response = await page.goto(editorUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `Editor did not load at ${editorUrl}`);
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
  await sheet.locator("input.componentInput").first().fill("Fields prompt");
  await sheet.getByRole("textbox", { name: "Option 1 label" }).fill("Fields route");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null);

  await sheet.getByRole("tab", { name: "Advanced" }).click();
  const structure = sheet.getByRole("textbox", { name: "Structure source" });
  assert.match(await structure.inputValue(), /<prompt>(?:Fields prompt|\{\{prompt\}\})<\/prompt>/);
  assert.match(await structure.inputValue(), /<option id="option0">(?:Fields route|\{\{options\[0\]\.label\}\})<\/option>/);
  await sheet.getByRole("tab", { name: "Style" }).click();
  const style = sheet.getByRole("textbox", { name: "Style source" });
  assert.match(await style.inputValue(), /choice \{[\s\S]*background: #15151C;/);
  assert.match(await style.inputValue(), /option \{[\s\S]*background: #A78BFA;/);
  await sheet.getByRole("tab", { name: "Logic" }).click();
  assert.match(await sheet.getByRole("textbox", { name: "Logic source" }).inputValue(), /on choose\(option0\) \{\s*continue\(\);\s*\}/);
  assert.match(await sheet.getByRole("textbox", { name: "Logic source" }).inputValue(), /on choose\(option1\) \{\s*continue\(\);\s*\}/);
  await sheet.getByRole("status").getByText(/Valid · preview updated/).waitFor({ state: "visible" });
  await sheet.getByRole("tab", { name: "Fields" }).click();
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null,
    "Inspecting the starter source must leave Fields editable");
  await sheet.getByRole("tab", { name: "Advanced" }).click();
  await sheet.getByRole("tab", { name: "Style" }).click();
  await style.fill((await style.inputValue()).replace("background: #A78BFA;", "background: #2EC4B6;"));
  await page.waitForFunction(() => {
    const option = document.querySelector(".compCustomRuntime iframe")?.contentDocument?.querySelector(".pvo-option");
    return option && getComputedStyle(option).backgroundColor === "rgb(46, 196, 182)";
  });
  await sheet.getByRole("tab", { name: "Fields" }).click();
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null,
    "A valid Style-only edit must leave Fields editable");
  await sheet.getByRole("textbox", { name: "Option 1 label" }).fill("Fields after style");
  await sheet.getByRole("tab", { name: "Advanced" }).click();
  await sheet.getByRole("tab", { name: "Structure" }).click();
  assert.match(await structure.inputValue(), /Fields after style/,
    "No-code text changes must update the Advanced source");
  const generated = await structure.inputValue();
  await structure.fill(generated
    .replace(/<prompt>[\s\S]*?<\/prompt>/, "<prompt>Language prompt</prompt>")
    .replace(/(<option id="option0">)[\s\S]*?(<\/option>)/, "$1Language route$2"));
  // Switching immediately must not cancel the compilation that synchronizes Fields.
  await sheet.getByRole("tab", { name: "Fields" }).click();
  const preview = page.locator(".compCustomRuntime iframe").first().contentFrame();
  await preview.getByRole("button", { name: "Language route" }).waitFor({ state: "visible" });
  assert.equal(await preview.getByText("Language prompt").count(), 1, "Preview should use edited PVO Structure");
  assert.equal(await sheet.locator("input.componentInput").first().inputValue(), "Language prompt");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).inputValue(), "Language route");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null);
  assert.equal(await sheet.locator(".componentOptionRow").first().locator(".componentOutcome").isDisabled(), false);

  await sheet.getByRole("tab", { name: "Advanced" }).click();
  await structure.fill((await structure.inputValue()).replace('id="option0"', 'id="primary"'));
  await sheet.getByRole("tab", { name: "Logic" }).click();
  const logic = sheet.getByRole("textbox", { name: "Logic source" });
  await logic.fill("on choose(primary) { jump_to(0.5); }\non choose(option1) { continue(); }");
  await sheet.getByRole("tab", { name: "Style" }).click();
  const customStyle = `${await style.inputValue()}\n#primary { color: #123456; }`;
  await style.fill(customStyle);
  await page.waitForFunction(() => {
    const option = document.querySelector(".compCustomRuntime iframe")?.contentDocument?.querySelector('[data-pvo-id="primary"]');
    return option && getComputedStyle(option).color === "rgb(18, 52, 86)";
  });
  await sheet.getByRole("tab", { name: "Fields" }).click();
  const firstOutcome = sheet.locator(".componentOptionRow").first().locator(".componentOutcome");
  assert.match(await firstOutcome.innerText(), /→/, "An Advanced Logic edit must update the no-code outcome");
  await sheet.locator("input.componentInput").first().fill("Synced prompt");
  await sheet.getByRole("textbox", { name: "Option 1 label" }).fill("Synced & <route>");
  await preview.getByRole("button", { name: "Synced & <route>", exact: true }).waitFor();
  assert.equal(await preview.getByText("Synced prompt", { exact: true }).count(), 1);
  assert.equal(await preview.locator('[data-pvo-id="primary"]').evaluate(element => getComputedStyle(element).backgroundColor), "rgb(46, 196, 182)");
  assert.equal(await preview.locator('[data-pvo-id="primary"]').evaluate(element => getComputedStyle(element).color), "rgb(18, 52, 86)");
  await firstOutcome.click();
  const outcomeSheet = page.getByRole("dialog", { name: /where\?/ });
  await outcomeSheet.getByRole("button", { name: /^Continue/ }).click();
  await outcomeSheet.getByRole("button", { name: "Back", exact: true }).click();
  await sheet.getByRole("tab", { name: "Advanced" }).click();
  await sheet.getByRole("tab", { name: "Structure" }).click();
  assert.match(await structure.inputValue(), /<option id="primary">Synced &amp; &lt;route&gt;<\/option>/,
    "Fields edits must preserve custom control IDs and escape text");
  await sheet.getByRole("tab", { name: "Style" }).click();
  assert.equal(await style.inputValue(), customStyle, "Fields edits must preserve authored Style");
  await sheet.getByRole("tab", { name: "Logic" }).click();
  assert.match(await logic.inputValue(), /on choose\(primary\) \{\s*continue\(\);\s*\}/,
    "A no-code outcome change must update the matching custom control's Logic");

  await sheet.getByRole("tab", { name: "Structure" }).click();
  await structure.fill('<choice><prompt>Broken</prompt><option id="primary" onclick="pvo.pick(0)">Invalid</option><option id="option1">Continue</option></choice>');
  await sheet.getByRole("alert").getByText(/Structure · line .*not allowed/i).waitFor({ state: "visible" });
  await preview.getByRole("button", { name: "Synced & <route>", exact: true }).waitFor({ state: "visible" });
  assert.equal(await preview.getByRole("button", { name: "Invalid" }).count(), 0,
    "An invalid draft must leave the last good preview mounted");
  await sheet.getByRole("tab", { name: "Fields" }).click();
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).inputValue(), "Synced & <route>");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), "");
  assert.equal(await sheet.locator(".componentOptionRow").first().locator(".componentOutcome").isDisabled(), true);
  assert.equal(await sheet.getByRole("button", { name: "Use playhead", exact: true }).isDisabled(), false,
    "An invalid content draft must not lock independent component timing");

  await sheet.getByRole("button", { name: "Reset to fields" }).click();
  const confirmation = page.getByRole("dialog", { name: "Replace your code?" });
  assert.match(await confirmation.innerText(), /Structure, Style and Logic/);
  await confirmation.getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null);
  assert.equal(await sheet.locator("input.componentInput").first().inputValue(), "Synced prompt");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).inputValue(), "Synced & <route>");
  await page.locator(".compChoice").getByRole("button", { name: "Synced & <route>", exact: true }).waitFor({ state: "visible" });

  await sheet.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Collapse component tools" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Tooltip" }).click();
  const tooltipSheet = page.getByRole("dialog", { name: "Tooltip" });
  await tooltipSheet.getByRole("tab", { name: "Advanced" }).click();
  await tooltipSheet.getByRole("tab", { name: "Style" }).click();
  assert.match(await tooltipSheet.getByRole("textbox", { name: "Style source" }).inputValue(), /tooltip \{[\s\S]*background: #FFD23E;/);
  await tooltipSheet.getByRole("tab", { name: "Logic" }).click();
  assert.equal(await tooltipSheet.getByRole("textbox", { name: "Logic source" }).inputValue(), "");
  assert.equal(await tooltipSheet.getByRole("textbox", { name: "Logic source" }).getAttribute("readonly"), "",
    "Tooltip Logic is display-only by design");
  await tooltipSheet.getByRole("status").getByText(/Valid · preview updated/).waitFor({ state: "visible" });

  await tooltipSheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Collapse component tools" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Form" }).click();
  const formSheet = page.getByRole("dialog", { name: "Form", exact: true });
  await formSheet.getByRole("tab", { name: "Advanced" }).click();
  const formStructure = formSheet.getByRole("textbox", { name: "Structure source" });
  await formStructure.fill('<form>\n  <field name="contactEmail" kind="email" />\n  <field name="givenName" kind="name" />\n  <submit>Send details</submit>\n</form>');
  await formSheet.getByRole("tab", { name: "Fields" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("input.componentInput")].some(input => input.value === "Send details"));
  assert.equal(await formSheet.getByRole("button", { name: "Email", exact: true }).getAttribute("data-on"), "true");
  assert.equal(await formSheet.getByRole("button", { name: "Name", exact: true }).getAttribute("data-on"), "true");
  await formSheet.getByRole("button", { name: "Phone", exact: true }).click();
  await formSheet.locator("input.componentInput").first().fill("Send & save");
  await formSheet.getByRole("tab", { name: "Advanced" }).click();
  assert.match(await formStructure.inputValue(), /<field name="contactEmail" kind="email"\s*\/>/,
    "No-code form edits must preserve authored field names used by request templates");
  assert.match(await formStructure.inputValue(), /<field name="givenName" kind="name"\s*\/>/);
  assert.match(await formStructure.inputValue(), /<field name="[^"]+" kind="phone"\s*\/>/);
  assert.match(await formStructure.inputValue(), /<submit>Send &amp; save<\/submit>/);
  await formSheet.getByRole("status").getByText(/Valid · preview updated/).waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
  console.log("PVO language editor passed: bidirectional Fields/source edits, Style/control-ID/form-name preservation, Logic outcomes, immediate route switch, invalid draft, Tooltip limits, reset.");
} catch (error) {
  console.error(`PVO language editor failed: ${error.message}`);
  console.error(`Vite overlay: ${await page.locator("vite-error-overlay").evaluateAll(items => items.map(item => item.shadowRoot?.textContent)).catch(() => "unavailable")}`);
  console.error(`Page errors: ${pageErrors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => ""))?.slice(0, 1400)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
