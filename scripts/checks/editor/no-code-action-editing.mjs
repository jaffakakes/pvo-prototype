import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const component = () => page.evaluate(() => window.capture.getState().components[0]);

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    window.capture = useCapture;
    const clips = [mkClip(20, null, 0)];
    useCapture.setState({ scenes: [{ id: "main", name: "Main", clips, texts: [], components: [], layers: ["video"], muted: false, sound: 0 }],
      currentSceneId: "main", clips, texts: [], components: [], layers: ["video"], screen: "editor", sheet: "components",
      t: 2, selComp: null, selText: null, sel: -1, tryMode: null, past: [], future: [] });
    const id = useCapture.getState().addComponent("form");
    useCapture.getState().updateComponent(id, { code: undefined,
      fields: {
        heading: "Send details",
        formFields: [{ name: "Name", type: "text" }, { name: "Email", type: "text" }],
        submitLabel: "Send", waitingLabel: "Sending…", formSubmitMode: "request",
        destination: "https://example.com/answers",
        successOutcome: { kind: "time", t: 3 }, failureOutcome: null,
        outcome: {
        kind: "request", url: "https://example.com/answers", method: "GET", body: "",
        onSuccess: { kind: "time", t: 3 }, onError: null,
        },
      } });
  });
  await page.getByRole("tab", { name: "Action", exact: true }).click();
  await page.getByRole("button", { name: "Open Advanced", exact: true }).click();
  assert.equal(await page.getByRole("tab", { name: "Logic", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("button", { name: "Request settings", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Destination URL", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("While sending, the button says", { exact: true }).count(), 0);
  const logic = page.getByLabel("Logic source", { exact: true });
  const originalLogic = await logic.inputValue();
  await logic.fill(originalLogic.replace(/"onError"\s*:\s*null/, '"onError":{"kind":"time","t":2}'));
  await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvoTouched === false);
  assert.equal((await component()).fields.successOutcome.t, 3, "Success route survives a direct failure-route edit");
  assert.equal((await component()).fields.failureOutcome.t, 2, "PVO edits set the independent failure route");
  assert.deepEqual((await component()).fields.formFields, [
    { name: "Name", type: "text" }, { name: "Email", type: "text" },
  ], "Request editing keeps current form field identities");
  assert.equal((await component()).fields.fieldKinds, undefined);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await component()).fields.fieldKinds, undefined, "Undo retains the current field format");
  assert.equal((await component()).fields.failureOutcome, null, "Undo restores the original request");
  await logic.fill(originalLogic.replace(/"onError"\s*:\s*null/, '"onError":{"kind":"time","t":7}'));
  await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvoTouched === false);
  assert.equal((await component()).fields.successOutcome.t, 3);
  assert.equal((await component()).fields.failureOutcome.t, 7, "Source-only Advanced can independently change response routes");

  await page.evaluate(async () => {
    const state = window.capture.getState();
    state.patch({ components: [], selComp: null, sheet: "components", t: 2 });
    const id = state.addComponent("choice");
    const current = window.capture.getState().components.find(item => item.id === id);
    const { takeOverWithCode } = await import("/src/domain/components/codeOwnership.ts");
    state.updateComponent(id, takeOverWithCode(current));
  });
  await page.waitForFunction(() => window.capture.getState().components[0]?.code?.pvoCompiled);
  await page.evaluate(() => {
    const state = window.capture.getState(), item = state.components[0];
    state.updateComponent(item.id, { code: { ...item.code, pvoTouched: true,
      pvo: { ...item.code.pvo, style: "choice { invalid-property: true; }" } } });
  });
  await page.getByRole("tab", { name: "Action", exact: true }).click();
  await page.getByRole("button", { name: /When viewers tap “Option A”/ }).click();
  await page.getByRole("button", { name: /^Jump to a point/ }).click();
  assert.equal((await component()).fields.options[0].outcome.t, 2, "Actions edit beside an invalid Style draft");
  assert.equal((await component()).code.pvo.style, "choice { invalid-property: true; }");
  assert.match((await component()).code.pvo.logic, /jump_to\(2\)/);

  await page.evaluate(() => {
    const state = window.capture.getState(), item = state.components[0];
    state.updateComponent(item.id, { code: { ...item.code, pvoTouched: true,
      pvo: { ...item.code.pvo, logic: "on choose(option0) {" } } });
  });
  await page.getByRole("button", { name: /^Continue video/ }).click();
  await page.getByRole("alert").filter({ hasText: "Fix this action’s Logic in Advanced first." }).waitFor();
  assert.equal((await component()).fields.options[0].outcome.t, 2, "Invalid target Logic does not silently replace the draft");
  await page.getByRole("button", { name: "Pick on timeline", exact: true }).click();
  await page.evaluate(() => window.capture.getState().patch({ t: 5 }));
  await page.getByRole("button", { name: "Use 0:05", exact: true }).click();
  await page.locator('.toolBar [role="alert"]').waitFor();
  assert(await page.evaluate(() => window.capture.getState().playheadPick), "Failed picker edits remain open with feedback");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => window.capture.getState().t), 2);
  await page.getByRole("button", { name: /^Go to a scene/ }).click();
  const sceneCount = await page.evaluate(() => window.capture.getState().scenes.length);
  await page.getByRole("button", { name: /New scene/ }).click();
  assert.equal(await page.evaluate(() => window.capture.getState().scenes.length), sceneCount, "Invalid Logic cannot create an unrouted scene");
  assert.deepEqual(errors, []);
  console.log("Action editing passed: source-only Advanced request branches, current field identities, undo, invalid-draft actions, picker feedback and new-scene preflight.");
} finally {
  await browser.close();
}
