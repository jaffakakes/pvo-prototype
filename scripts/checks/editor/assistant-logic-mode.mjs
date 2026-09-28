import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(12000);
const errors = [], requests = [];
let releaseResponse;
let reportDelayed;
const delayedReady = new Promise(resolve => { reportDelayed = resolve; });
page.on("pageerror", error => errors.push(error.message));
const phase = name => page.locator(`[data-assistant-phase="${name}"]`);
const input = page.getByRole("textbox", { name: "Describe a change", exact: true });
const button = name => page.getByRole("button", { name, exact: true });
const saved = () => page.evaluate(() => {
  const state = window.capture.getState(), component = state.components[0];
  return JSON.parse(JSON.stringify({ fields: component.fields, look: component.look, code: component.code,
    past: state.past.length, future: state.future.length }));
});
const submit = async words => {
  await input.fill(words);
  await button("Send request").click();
};

try {
  await page.route("**/api/assistant", async route => {
    const request = route.request().postDataJSON();
    requests.push(request);
    if (request.prompt === "Delayed appearance") await new Promise(resolve => { releaseResponse = resolve; reportDelayed(); });
    const source = { ...request.source };
    if (request.prompt === "Change logic") {
      const action = { url: "https://example.com", method: "POST", body: "{}", onSuccess: { kind: "continue" }, onError: null };
      source.logic = source.logic.replaceAll("continue()", `request(${JSON.stringify(action)})`);
    } else source.style += '\ntitle { font-size: 23px; font-weight: 900; } card { border-radius: 11px; }';
    await route.fulfill({ json: { source, summary: "Updated the component.", tags: [], followUps: ["Blue", "Softer", "Larger"] } });
  });
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async root => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    window.capture = useCapture;
    window.preferences = (await import("/src/state/preferences/editorPreferences.ts")).useEditorPreferences;
    window.assistant = (await import("/src/state/assistant/assistantStore.ts")).useAssistant;
    window.reviewTools = await import("/src/domain/assistant/review.ts");
    window.compilePvo = (await import(`/@fs/${root}packages/pvo-language/index.js`)).compilePvoComponent;
    window.preferences.setState({ advancedEditingEnabled: false });
    const clips = [mkClip(10, null, 0)];
    useCapture.getState().patch({ scenes: [{ id: "main", name: "Main", clips, texts: [], components: [], layers: ["video"], muted: true, sound: -1 }],
      currentSceneId: "main", clips, texts: [], components: [], layers: ["video"], screen: "editor", sheet: null,
      selComp: null, t: 0, past: [], future: [], playing: false });
    useCapture.getState().addComponent("card");
    useCapture.getState().patch({ sheet: null });
  }, root);
  const before = await saved();
  await page.locator("[data-assistant-orb]").click();
  await submit("Custom appearance");
  await phase("review").waitFor();
  assert.equal(requests.at(-1).editingMode, "no-code");
  assert.deepEqual(await saved(), before, "A visual proposal does not mutate the project before Keep");
  await button("Keep").click();
  await phase("idle").waitFor();
  const kept = await saved();
  assert.match(kept.code.pvo.style, /23px/);
  assert.equal(kept.past, before.past + 1);
  await button("Undo").click();
  assert.deepEqual((await saved()).fields, before.fields);
  assert.equal((await saved()).code, before.code);
  await button("Redo").click();
  assert.deepEqual((await saved()).code, kept.code);

  await page.locator("[data-assistant-orb]").click();
  const beforeRejected = await saved();
  await submit("Change logic");
  await phase("typing").waitFor();
  await page.getByText("Enable Advanced for this logic change.", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Change logic");
  assert.equal(await button("Keep").count(), 0);
  assert.deepEqual(await saved(), beforeRejected, "Rejected logic preserves fields, source, undo and redo");

  // Preference changes can arrive while a response is in flight (for example from another settings surface).
  await page.evaluate(() => window.preferences.setState({ advancedEditingEnabled: true }));
  await submit("Delayed appearance");
  await phase("working").waitFor();
  await delayedReady;
  assert.equal(requests.at(-1).editingMode, "advanced");
  await page.evaluate(() => window.preferences.setState({ advancedEditingEnabled: false }));
  releaseResponse();
  await phase("review").waitFor();
  assert.deepEqual(await saved(), beforeRejected, "Turning Advanced off does not block an appearance-only preview");
  await page.getByRole("region", { name: "Review assistant change" }).getByRole("button", { name: "Undo", exact: true }).click();
  await phase("typing").waitFor();

  // A previously prepared advanced review must disappear immediately if Advanced is disabled.
  await page.evaluate(async () => {
    window.preferences.setState({ advancedEditingEnabled: true });
    const original = window.capture.getState().components[0];
    const source = window.reviewTools.assistantSource(original);
    const action = { url: "https://example.com", method: "POST", body: "{}", onSuccess: { kind: "continue" }, onError: null };
    const proposed = { ...source, logic: source.logic.replaceAll("continue()", `request(${JSON.stringify(action)})`) };
    const compiled = await window.compilePvo(original.type, proposed);
    const review = window.reviewTools.createAssistantReview(original, { source: proposed, compiled, summary: "Logic change",
      mode: "connected", label: "PVO assistant", tags: [], followUps: ["Blue", "Softer", "Larger"] }, "Prepared advanced logic");
    window.assistant.setState({ phase: "review", review });
  });
  await phase("review").waitFor();
  await page.evaluate(() => window.preferences.setState({ advancedEditingEnabled: false }));
  await phase("typing").waitFor();
  assert.equal(await input.inputValue(), "Prepared advanced logic");
  assert.equal(await button("Keep").count(), 0);
  assert.deepEqual(await saved(), beforeRejected);
  assert.deepEqual(errors, []);
  console.log("Assistant logic mode passed: custom appearances while off, blocked logic without mutation, atomic Undo/Redo, in-flight mode changes and discarded advanced previews.");
} finally {
  releaseResponse?.();
  await browser.close();
}
