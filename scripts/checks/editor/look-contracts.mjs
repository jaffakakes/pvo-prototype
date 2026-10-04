import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async root => {
    const { defaultFields } = await import("/src/domain/components/defaults.ts");
    const { createLook } = await import("/src/domain/components/look.ts");
    const { componentLanguageSource } = await import("/src/domain/components/languageCompilation.ts");
    const { buildPvoManifest } = await import("/src/domain/export/manifest.ts");
    const { compilePvoComponent } = await import(`/@fs/${root}packages/pvo-language/index.js`);
    const { registerComponentView } = await import(`/@fs/${root}player/components/legacy-view.js`);
    registerComponentView();
    const compiledCases = [];
    for (const type of ["tooltip", "card", "choice", "form"]) {
      for (const preset of ["bold", "soft", "minimal", "contrast"]) {
        const component = {
          id: `${type}-${preset}`, type, sceneId: "main", at: 1, dur: 3, x: 50, y: 50,
          ...(type === "tooltip" ? {} : { responsePolicy: { dispatch: "interaction", unanswered: "continue" } }),
          fields: defaultFields(type), look: createLook(preset, type === "choice" ? 2 : type === "tooltip" ? 0 : 1),
        };
        await compilePvoComponent(type, componentLanguageSource(component));
        compiledCases.push(`${type}/${preset}`);
      }
    }
    const component = {
      id: "form-player", type: "form", sceneId: "main", at: 1, dur: null, x: 50, y: 60,
      responsePolicy: { dispatch: "interaction", unanswered: "pause" },
      fields: {
      ...defaultFields("form"), formFields: [{ name: "Height", type: "number" }, { name: "Subscribe?", type: "yesno" }], waitingLabel: "Working…",
      },
      look: createLook("soft", 1),
    };
    component.look.body.color = "#FF5C5C";
    component.look.body.size = "XL";
    component.look.btns[0].fill = "#00E5A0";
    const clip = { id: 1, url: null, color: "#000", srcDur: 10, in: 0, out: 10, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "cover" };
    const scene = { id: "main", name: "Main", parent: null, clips: [clip], texts: [], components: [component], muted: true, sound: -1 };
    const manifest = buildPvoManifest({ scenes: [scene], currentSceneId: "main", ratio: "9:16", allowedDomains: [] }, [{ scene, assetId: "video", name: "main.mp4", type: "video/mp4" }]);
    const view = document.createElement("pvo-component-view");
    view.update(manifest.components[0], undefined, true, 1);
    document.body.append(view);
    const shadow = view.shadowRoot;
    const form = shadow.querySelector("form");
    const input = shadow.querySelector("input");
    const select = shadow.querySelector("select");
    const submit = shadow.querySelector("button");
    const before = {
      heading: shadow.querySelector("h3").textContent,
      background: getComputedStyle(form).backgroundColor,
      inputColor: getComputedStyle(input).color,
      inputSize: getComputedStyle(input).fontSize,
      inputType: input.type, step: input.step, selection: select.value,
      submitFill: getComputedStyle(submit).backgroundColor,
    };
    input.value = "172.5";
    const validNumber = input.checkValidity();
    view.setPending(true);
    const pending = { disabled: submit.disabled, label: submit.textContent };
    view.setPending(false);
    const after = { disabled: submit.disabled, label: submit.textContent };
    view.remove();
    return { compiledCases, before, validNumber, pending, after };
  }, root);
  assert.equal(result.compiledCases.length, 16);
  assert.equal(result.before.heading, "Get early access");
  assert.equal(result.before.background, "rgb(242, 240, 233)");
  assert.equal(result.before.inputColor, "rgb(255, 92, 92)");
  assert.equal(result.before.inputSize, "13.5px");
  assert.equal(result.before.inputType, "number");
  assert.equal(result.before.step, "any");
  assert.equal(result.before.selection, "no");
  assert.equal(result.before.submitFill, "rgb(0, 229, 160)");
  assert.equal(result.validNumber, true);
  assert.deepEqual(result.pending, { disabled: true, label: "Working…" });
  assert.deepEqual(result.after, { disabled: false, label: "Continue" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const moduleUrl = name => performance.getEntriesByType("resource").map(item => item.name).find(url => url.includes(`/src/state/${name}.ts`));
    const { useCapture } = await import(moduleUrl("captureStore"));
    const { setComponentAuthoringTab } = await import(moduleUrl("components/componentAuthoringStore"));
    window.lookTestCapture = useCapture;
    const clip = { id: 1, url: null, color: "#333", srcDur: 10, in: 0, out: 10, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "cover" };
    const scene = { id: "main", name: "Main", parent: null, clips: [clip], texts: [], components: [], muted: true, sound: -1, layers: ["video"] };
    useCapture.getState().patch({ scenes: [scene], clips: scene.clips, texts: [], components: [], currentSceneId: "main", screen: "editor", sheet: null, t: 2, past: [], future: [] });
    const id = useCapture.getState().addComponent("choice");
    setComponentAuthoringTab(id, "content");
  });
  await page.locator("#restyle-launch-splash").waitFor({ state: "detached" });
  const secondOption = await page.locator('[data-look-part="button:1"]').boundingBox();
  assert(secondOption, "The second option is visible on the video");
  await page.mouse.click(secondOption.x + secondOption.width / 2, secondOption.y + secondOption.height / 2);
  assert.equal(await page.getByRole("tab", { name: "Look", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator('[data-look-part="button:1"]').getAttribute("data-part-selected"), "true");
  await page.getByRole("button", { name: "Custom", exact: true }).first().click();
  const historyLength = () => page.evaluate(() => window.lookTestCapture.getState().past.length);
  const beforeSlider = await historyLength();
  const slider = page.getByRole("slider", { name: "Fill hue", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  assert.equal(await historyLength(), beforeSlider + 1, "Continuous colour changes group undo");
  const hex = page.getByRole("textbox", { name: "Fill hex", exact: true });
  await hex.focus();
  await hex.press("ControlOrMeta+A");
  await hex.pressSequentially("#123456");
  assert.equal(await hex.inputValue(), "#123456");
  const editedLook = await page.evaluate(() => window.lookTestCapture.getState().components[0].look);
  assert.equal(editedLook.btns[1].fill, "#123456");
  assert.equal(editedLook.btns[0].fill, "#FF9FBC");
  console.log("PASS: all 16 preset/compiler contracts and exported native player appearance, numeric forms and pending labels.");
  console.log("PASS: video tap selects its Look part, continuous slider changes group undo, and full hex typing preserves the other option.");
} finally {
  await browser.close();
}
