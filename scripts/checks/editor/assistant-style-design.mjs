import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  parseNativeTurnRequest,
  parseNativeTurnResult,
} from "../../../packages/pvo-assistant/native/index.js";
import {
  finishAssistantVerification,
  installAssistantAvailabilityFixture,
} from "./assistant-fixture.mjs";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await installAssistantAvailabilityFixture(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const fixtureErrors = [];
let calls = 0;
page.on("pageerror", (error) => errors.push(error.message));

const prompt =
  "Redesign this choice so it feels like a bold editorial poster. Change the spacing, type, button shape and shadows, and remove the dark panel behind the rounded corners.";
const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll(
  "\\",
  "/",
);
const style = `choice { background: transparent; border-width: 0; box-shadow: none; padding: 0; gap: 16px; }
prompt { color: #FFFFFF; font-size: 24px; font-weight: 800; line-height: 1.2; letter-spacing: 1px; text-transform: uppercase; text-align: center; }
option { font-size: 18px; font-weight: 700; border-radius: 20px; border-width: 2px; border-color: #FFFFFF; padding: 18px; box-shadow: 0px 6px 16px #101020; }
#option0 { background: #FF9FBC; color: #15151C; }
#option1 { background: #00E5A0; color: #15151C; }`;

await context.route("**/api/assistant/turn", async (route) => {
  try {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    assert.equal(request.prompt, prompt);
    if (await finishAssistantVerification(route, request)) return;
    calls++;
    const scene = request.project.scenes[0];
    const component = scene.components.find(
      (item) => item.id === request.project.selection.componentId,
    );
    assert(
      component?.source,
      "The selected Choice exposes source to the assistant",
    );
    await route.fulfill({
      json: parseNativeTurnResult({
        message:
          "Redesigned the choice with transparent framing, stronger typography, more space and shaped buttons.",
        observations: [],
        operations: [
          {
            kind: "component.update",
            sceneId: scene.id,
            componentId: component.id,
            changes: { width: 510, y: 56 },
          },
          {
            kind: "component.style",
            sceneId: scene.id,
            componentId: component.id,
            style,
          },
        ],
      }),
    });
  } catch (error) {
    fixtureErrors.push(error.message);
    await route.fulfill({
      status: 500,
      json: { error: { message: "Fixture failed." } },
    });
  }
});

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", {
    waitUntil: "networkidle",
  });
  await page.evaluate(async (root) => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { readVideoMetadata } =
      await import("/src/infrastructure/media/readVideo.ts");
    const response = await fetch(`/@fs/${root}share/assets/preview.mp4`);
    if (!response.ok) throw new Error("Sample video is unavailable.");
    const videoUrl = URL.createObjectURL(await response.blob());
    const metadata = await readVideoMetadata(videoUrl);
    useCapture.setState(initial());
    useCapture.getState().patch({
      screen: "editor",
      clips: [
        mkClip(metadata.duration, videoUrl, 0, metadata.width, metadata.height),
      ],
      ratio: "9:16",
      sound: -1,
      muted: true,
      t: 1,
      playing: false,
      sel: -1,
      past: [],
      future: [],
    });
    const id = useCapture.getState().addComponent("choice");
    const component = useCapture
      .getState()
      .components.find((item) => item.id === id);
    useCapture.getState().updateComponent(
      id,
      {
        fields: {
          ...component.fields,
          prompt: "Where to next?",
          options: component.fields.options.map((option, index) => ({
            ...option,
            label: index === 0 ? "EXPLORE" : "STAY HERE",
          })),
        },
      },
      false,
    );
    useCapture
      .getState()
      .patch({ selComp: id, sheet: null, t: 1, past: [], future: [] });
  }, root);
  await page.locator(".pvBox").waitFor();
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    return (
      video &&
      video.readyState >= 2 &&
      !video.seeking &&
      Math.abs(video.currentTime - 1) < 0.05
    );
  });
  const beforeOption = page
    .locator(".compChoice")
    .getByRole("button", { name: "EXPLORE" });
  await beforeOption.waitFor();
  const output = process.env.RESTYLE_STYLE_SCREENSHOTS;
  if (output) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: `${output}/choice-before.png` });
  }

  await page.locator("[data-assistant-orb]").click();
  await page
    .getByRole("textbox", { name: "Describe a change", exact: true })
    .fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const notice = page.locator('[data-notification-id="assistantApplied"]');
  await notice.waitFor();
  const frame = page
    .locator(".compCustomRuntime iframe")
    .first()
    .contentFrame();
  await page.waitForFunction(() => {
    const choice = document
      .querySelector(".compCustomRuntime iframe")
      ?.contentDocument?.querySelector(".pvo-choice");
    return choice && getComputedStyle(choice).gap === "16px";
  });
  const appearance = await frame.locator(".pvo-choice").evaluate((choice) => {
    const view = choice.ownerDocument.defaultView;
    const option = choice.querySelector(".pvo-option");
    return {
      background: view.getComputedStyle(choice).backgroundColor,
      gap: view.getComputedStyle(choice).gap,
      radius: view.getComputedStyle(option).borderRadius,
      shadow: view.getComputedStyle(option).boxShadow,
      promptTransform: view.getComputedStyle(
        choice.querySelector(".pvo-prompt"),
      ).textTransform,
    };
  });
  assert.equal(appearance.background, "rgba(0, 0, 0, 0)");
  assert.equal(appearance.gap, "16px");
  assert.equal(appearance.radius, "20px");
  assert.notEqual(appearance.shadow, "none");
  assert.equal(appearance.promptTransform, "uppercase");
  const component = await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    return useCapture.getState().components[0];
  });
  assert.match(component.code.pvo.style, /background: transparent/);
  assert.match(component.code.pvo.style, /box-shadow: 0px 6px 16px #101020/);
  assert.equal(component.width, 510);
  assert.equal(calls, 1);
  assert.deepEqual(fixtureErrors, []);
  assert.deepEqual(errors, []);
  await notice
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  if (output) await page.screenshot({ path: `${output}/choice-after.png` });
  const bytes = await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const { exportPvo } = await import("/src/features/export/exportPvo.ts");
    const exported = await exportPvo(useCapture.getState(), () => {});
    try {
      return Array.from(
        new Uint8Array(await (await fetch(exported.url)).arrayBuffer()),
      );
    } finally {
      URL.revokeObjectURL(exported.url);
    }
  });
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: 390, height: 844 });
  viewer.setDefaultTimeout(15000);
  await viewer.goto(
    process.env.PVO_PLAYER_URL || new URL("../player/", page.url()).href,
    { waitUntil: "networkidle" },
  );
  await viewer.locator("#pvoInput").setInputFiles({
    name: "restyle-design.pvo",
    mimeType: "application/vnd.pvo",
    buffer: Buffer.from(bytes),
  });
  await viewer.locator("#playerShell").waitFor({ state: "visible" });
  await viewer.waitForFunction(
    () => document.querySelector("#video")?.readyState >= 2,
  );
  await viewer.locator("#video").evaluate(async (video) => {
    await video.play();
  });
  await viewer.waitForFunction(
    () => document.querySelector("#video")?.currentTime > 0.1,
  );
  await viewer.locator("#video").evaluate((video) => {
    video.pause();
    video.currentTime = 1.5;
  });
  await viewer.waitForFunction(
    () => Math.abs(document.querySelector("#video")?.currentTime - 1.5) < 0.05,
  );
  const playerFrame = viewer
    .locator(".code-position iframe")
    .first()
    .contentFrame();
  await playerFrame.getByRole("button", { name: "EXPLORE" }).waitFor();
  assert.equal(
    await playerFrame
      .locator(".pvo-choice")
      .evaluate((choice) => getComputedStyle(choice).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  if (output) await viewer.screenshot({ path: `${output}/choice-player.png` });
  console.log(
    "Assistant style design passed: a real native turn changes geometry, spacing, typography and shadows, with transparent Choice corners in editor and player.",
  );
} catch (error) {
  if (process.env.RESTYLE_STYLE_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.RESTYLE_STYLE_SCREENSHOTS}/choice-failure.png`,
    });
  console.error({ fixtureErrors, errors });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
