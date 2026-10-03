import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { fontFamily } from "../../../packages/pvo-fonts/index.js";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

// Inference is a fixture; editor orchestration, source compilation, saved fonts,
// sandbox rendering, telephone entry, submission and history are real.
const prompt = "can we add a component that takes phone number place the component bottom right of the screen please make the component ui clean dot use the standard ui make it easy to read different font";
const bytes = await readFile(new URL("../../../editor/src/fonts/peace-sans.woff2", import.meta.url));
const font = { id: "web-phone-fixture", family: "Contact Fixture", sourceUrl: "https://foundry.example/contact.woff2",
  licenseUrl: "https://foundry.example/license", licenseText: "Internal fixture license.",
  faces: [{ dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, weight: "400 700", style: "normal" }] };
const source = {
  structure: '<form><heading>Keep in touch</heading><field name="contact" kind="phone" label="Phone number"/><submit>Continue</submit></form>',
  style: 'form { background: #102c3b; color: #ffffff; border-color: #102c3b; border-radius: 24px; } heading { font-size: 22px; } field { font-size: 20px; border-radius: 12px; } submit { background: #d2ff70; color: #102c3b; border-radius: 16px; }',
  logic: 'on submit { continue(); }',
};
const family = fontFamily(font);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const result = (message, operations = [], observations = []) => parseNativeTurnResult({ message, operations, observations });

async function check(viewport, label) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await installAssistantAvailabilityFixture(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], fixtureErrors = [], externalRequests = [];
  let rounds = 0, componentId, baseline;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().startsWith("https://foundry.example")) externalRequests.push(request.url()); });
  const snapshot = () => page.evaluate(() => {
    const state = window.phoneFormCapture.getState();
    return JSON.parse(JSON.stringify({ scenes: state.scenes, ratio: state.ratio, past: state.past.length }));
  });
  await context.route("**/api/assistant/turn", async route => {
    try {
      const input = parseNativeTurnRequest(route.request().postDataJSON());
      assert.equal(input.prompt, prompt);
      assert.deepEqual(await snapshot(), baseline, "The live project stays unchanged throughout the private candidate workflow");
      assert.doesNotMatch(JSON.stringify(input), /data:font|Internal fixture license|"faces"/);
      const scene = input.project.scenes[0];
      let response;
      if (++rounds === 1) response = result("Checking saved typefaces.", [], [{ kind: "saved_fonts" }]);
      else if (rounds === 2) {
        assert.equal(input.observations[0].kind, "saved_fonts");
        assert.deepEqual(input.observations[0].fonts, [{ id: font.id, family: font.family, sourceUrl: font.sourceUrl }]);
        response = result("Preparing the phone form.", [{ kind: "component.add", sceneId: scene.id, componentType: "form", at: 0, duration: 30, source }]);
      } else if (rounds === 3) {
        assert.equal(scene.components.length, 1);
        componentId = scene.components[0].id;
        const receipt = input.execution.receipts[0].changes.find(change => change.after?.kind === "component");
        assert.equal(receipt.before, null);
        assert.equal(receipt.after.values.id, componentId, "Dependent operations use the actual creation receipt identity");
        assert.deepEqual(scene.components[0].formFields, [{ name: "contact", kind: "phone" }]);
        const { width: canvasWidth, height: canvasHeight } = input.project.canvas;
        const width = canvasWidth * 0.68, height = width * 0.8, margin = canvasWidth * 0.04;
        response = result("Placing the form and applying the font.", [
          { kind: "component.update", sceneId: scene.id, componentId, changes: { width, height, scale: 1,
            x: 100 * (canvasWidth - margin - width / 2) / canvasWidth,
            y: 100 * (canvasHeight - margin - height / 2) / canvasHeight } },
          { kind: "font.apply", sceneId: scene.id, target: { kind: "component", id: componentId }, fontId: font.id },
        ]);
      } else {
        assert.equal(rounds, 4);
        const component = scene.components[0];
        assert.deepEqual(component.formFields, [{ name: "contact", kind: "phone" }]);
        assert.deepEqual(component.font, { id: font.id, family: font.family });
        assert.ok(component.x > 50 && component.y > 50);
        assert.deepEqual(input.execution.receipts.map(receipt => receipt.operation), ["component.add", "component.update", "font.apply"]);
        response = result("Added the phone form at the lower right with the saved font.");
      }
      await route.fulfill({ json: response });
    } catch (error) {
      fixtureErrors.push(error.message);
      await route.fulfill({ status: 500, json: { error: { message: "Fixture assertion failed." } } });
    }
  });
  try {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5198/", { waitUntil: "networkidle" });
    await page.evaluate(async ({ font, label }) => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      const { resetAssistant } = await import("/src/state/assistant/assistantStore.ts");
      const { navigateProject } = await import("/src/app/navigation.ts");
      const { writeSavedFont } = await import("/src/infrastructure/fonts/library.ts");
      useCapture.setState(initial());
      resetAssistant();
      window.phoneFormCapture = useCapture;
      const localId = `phone-form-${label}`;
      useCapture.getState().patch({ localId, screen: "editor", clips: [mkClip(30, null, 0)], ratio: "9:16",
        sound: -1, muted: true, t: 1, playing: false, sel: -1, selComp: null, past: [], future: [] });
      navigateProject(localId, true);
      await writeSavedFont(font);
    }, { font, label });
    await page.locator('[data-assistant-phase="idle"]').waitFor();
    baseline = await snapshot();
    await page.locator("[data-assistant-orb]").click();
    await page.getByRole("textbox", { name: "Describe a change", exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    const notice = page.locator('[data-notification-id="assistantApplied"]');
    await notice.waitFor();
    await notice.getByRole("button", { name: "Dismiss notification", exact: true }).click();
    const applied = await snapshot();
    assert.equal(applied.past, baseline.past + 1);
    assert.equal(applied.scenes[0].components.length, 1);
    assert.deepEqual(applied.scenes[0].clips, baseline.scenes[0].clips);
    const overlay = page.locator(`[data-preview-component="${componentId}"]`);
    await page.getByRole("button", { name: "Try", exact: true }).click();
    const frame = overlay.frameLocator('iframe[sandbox="allow-same-origin"]');
    const input = frame.getByRole("textbox", { name: "Phone number", exact: true });
    await input.waitFor();
    assert.equal(await input.getAttribute("type"), "tel");
    await page.waitForFunction(({ componentId, family }) => {
      const doc = document.querySelector(`[data-preview-component="${componentId}"] iframe[sandbox="allow-same-origin"]`)?.contentDocument;
      return doc && [...doc.fonts].some(face => face.family === family && face.status === "loaded");
    }, { componentId, family });
    const appearance = await frame.locator("form").evaluate(form => {
      const doc = form.ownerDocument, style = doc.defaultView.getComputedStyle(form);
      return { background: style.backgroundColor, radius: style.borderRadius,
        families: [form.querySelector("input"), form.querySelector("button")].map(element => doc.defaultView.getComputedStyle(element).fontFamily) };
    });
    assert.equal(appearance.background, "rgb(16, 44, 59)");
    assert.equal(appearance.radius, "24px");
    assert.deepEqual(appearance.families.map(value => value.replaceAll('"', "")), [family, family]);
    // The runtime's parent resizes after compilation and font decoding. Wait for
    // the real rendered geometry to settle before checking clipping.
    await page.waitForFunction(componentId => {
      const overlay = document.querySelector(`[data-preview-component="${componentId}"]`);
      const canvas = document.querySelector(".pvBox");
      if (!overlay || !canvas) return false;
      const a = overlay.getBoundingClientRect(), b = canvas.getBoundingClientRect();
      return a.width > b.width * 0.65 && a.width < b.width * 0.71 && a.height > 60;
    }, componentId);
    const bounds = await overlay.evaluate(element => {
      const a = element.getBoundingClientRect(), b = element.closest(".pvBox").getBoundingClientRect();
      return { left: a.left - b.left, top: a.top - b.top, right: b.right - a.right, bottom: b.bottom - a.bottom,
        width: a.width, height: a.height, canvasWidth: b.width, canvasHeight: b.height };
    });
    for (const edge of ["left", "top", "right", "bottom"]) assert.ok(bounds[edge] >= -1, `${label}: ${edge} clips outside the canvas: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.right < bounds.canvasWidth * 0.07 && bounds.bottom < bounds.canvasWidth * 0.07, `${label}: visible form hugs the requested corner`);
    assert.ok(bounds.left > bounds.right && bounds.top > bounds.bottom, `${label}: form occupies the lower-right region`);
    const phoneNumber = "+44 00123 456789";
    await input.fill(phoneNumber);
    assert.equal(await input.inputValue(), phoneNumber, "Telephone input preserves plus signs and leading zeroes");
    await frame.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForFunction(({ componentId, phoneNumber }) => {
      const response = window.phoneFormCapture.getState().tryMode?.capturedResponses[componentId];
      return response?.formValues?.contact === phoneNumber;
    }, { componentId, phoneNumber });
    assert.deepEqual(await snapshot(), applied, "Viewer input does not mutate project/history");
    await page.screenshot({ path: `/tmp/restyle-phone-form-${label}.png` });
    await page.getByRole("button", { name: "Stop trying", exact: true }).click();
    await page.evaluate(() => window.phoneFormCapture.getState().undo());
    assert.deepEqual(await snapshot(), baseline, "One Undo removes source, placement and font together");
    await page.evaluate(() => window.phoneFormCapture.getState().redo());
    assert.deepEqual(await snapshot(), applied);
    assert.equal(rounds, 4);
    assert.deepEqual(externalRequests, [], "Local form entry and saved font never create a collection or font network request");
    assert.deepEqual(fixtureErrors, []);
    assert.deepEqual(errors, []);
    console.log(`PASS ${label} phone form: real compilation, saved font, actual tel entry/submission, custom appearance, visible corner bounds and atomic Undo/Redo.`);
  } catch (error) {
    console.error({ label, rounds, fixtureErrors, errors });
    await page.screenshot({ path: `/tmp/restyle-phone-form-${label}-failure.png` });
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await check({ width: 1440, height: 960 }, "desktop");
  await check({ width: 390, height: 844 }, "phone");
} finally {
  await browser.close();
}
