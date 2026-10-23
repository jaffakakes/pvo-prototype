import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchBrowser } from "../helpers/browser.mjs";

const output = join(tmpdir(), "restyle-shared-transform-shots");
await mkdir(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const media = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
).replaceAll("\\", "/");
const errors = [];
try {
  for (const [width, height, theme] of [
    [393, 852, "light"],
    [320, 693, "dark"],
    [1440, 900, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/");
    await page.evaluate(
      async ({ media, theme }) => {
        const { useCapture, mkClip } = await import("/src/store.ts");
        const { initial } = await import("/src/state/project/initial.ts");
        const { selectTimelineLayer } =
          await import("/src/state/editing/layerSelection.ts");
        const { readAuthoringValue } =
          await import("/src/domain/animation/authoring.ts");
        const { selectComponentLayer } =
          await import("/src/state/components/componentLayerCommands.ts");
        useCapture.setState(initial());
        const clip = mkClip(
          4,
          URL.createObjectURL(await (await fetch(`/@fs/${media}`)).blob()),
          0,
        );
        useCapture
          .getState()
          .patch({ screen: "editor", clips: [clip], t: 0, playing: false });
        const id = useCapture.getState().addComponent("tooltip");
        useCapture
          .getState()
          .updateComponent(id, { at: 0, dur: 4, x: 50, y: 32 }, false);
        const textId = useCapture.getState().addText("Selected text");
        useCapture
          .getState()
          .updateText(textId, { start: 0, end: 4, x: 50, y: 72 }, false);
        useCapture.getState().patch({
          t: 1,
          sel: 0,
          selComp: null,
          selText: null,
          sheet: "crop",
          past: [],
          future: [],
        });
        document.documentElement.dataset.theme = theme;
        window.sharedTransform = {
          useCapture,
          id,
          textId,
          selectTimelineLayer,
          selectComponentLayer,
          readAuthoringValue,
        };
        await document.fonts.ready;
      },
      { media, theme },
    );
    const settle = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    await page.getByRole("region", { name: "Crop", exact: true }).waitFor();
    const component = page.locator(".pvBox [data-preview-component]");
    const snapshot = () =>
      page.evaluate(() => {
        const { useCapture, id, readAuthoringValue } = window.sharedTransform;
        const state = useCapture.getState(),
          scene = state.scenes.find((item) => item.id === state.currentSceneId);
        const target = { kind: "component", id };
        return {
          clip: JSON.parse(JSON.stringify(state.clips[0])),
          component: JSON.parse(JSON.stringify(state.components[0])),
          sheet: state.sheet,
          sel: state.sel,
          selComp: state.selComp,
          selText: state.selText,
          past: state.past.length,
          position: readAuthoringValue(scene, target, "position", state.t),
          scale: readAuthoringValue(scene, target, "scale", state.t),
          rotation: readAuthoringValue(scene, target, "rotation", state.t),
        };
      });
    const original = await snapshot();
    await component.click();
    await page
      .getByRole("region", { name: "Transform", exact: true })
      .waitFor();
    assert.equal(
      (await snapshot()).sheet,
      "crop",
      "Selecting a component keeps the shared tool open",
    );
    assert.equal(
      await page.getByRole("button", { name: "Fit", exact: true }).count(),
      0,
      "Video-only framing controls follow the selected type",
    );
    assert.equal(
      await page.locator("[data-component-control='transform']").count(),
      0,
    );
    const center = async () => {
      const b = await component.boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    let point = await center();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 10, point.y + 8, { steps: 6 });
    await page.mouse.up();
    const moved = await snapshot();
    assert.equal(moved.past, original.past + 1);
    assert(
      moved.position.x > original.position.x &&
        moved.position.y > original.position.y,
    );
    assert.deepEqual(
      moved.clip,
      original.clip,
      "Moving the selected component leaves video unchanged",
    );
    await page.evaluate(() =>
      window.sharedTransform.useCapture.getState().undo(),
    );
    assert.deepEqual((await snapshot()).component, original.component);
    await page.evaluate(() =>
      window.sharedTransform.useCapture.getState().redo(),
    );
    assert.deepEqual((await snapshot()).component, moved.component);
    point = await center();
    const points = (progress) =>
      [0, 1].map((id) => {
        const radius = (id ? 1 : -1) * 10 * (1 + progress * 0.2),
          angle = (progress * Math.PI) / 9;
        return {
          id,
          x: point.x + radius * Math.cos(angle),
          y: point.y + radius * Math.sin(angle),
        };
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(0),
    });
    for (let step = 1; step <= 10; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(step / 10),
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await settle();
    const pinched = await snapshot();
    assert(
      Math.abs(pinched.scale - 1.2) < 0.02,
      "The video pinch handler scales the component",
    );
    assert(
      Math.abs(pinched.rotation - 20) < 0.2,
      "Twisting rotates the component",
    );
    assert.equal(
      pinched.past,
      moved.past + 1,
      "Pinch and twist share one Undo",
    );
    await page
      .locator('[data-transform-handle][data-corner="br"]')
      .press("ArrowUp");
    assert(
      (await snapshot()).scale > pinched.scale,
      "Shared handles support keyboard resize",
    );
    await page
      .getByRole("group", { name: "Transform note", exact: true })
      .press("]");
    assert((await snapshot()).rotation > pinched.rotation);
    const beforeCancel = await snapshot();
    point = await center();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 10, point.y + 8, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(
      await snapshot(),
      beforeCancel,
      "Escape rolls back only the gesture and leaves the tool open",
    );
    await page.screenshot({ path: join(output, `${width}-${theme}.png`) });
    await page
      .getByRole("region", { name: "Transform", exact: true })
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    assert.equal((await snapshot()).scale, 1);
    assert.equal((await snapshot()).rotation, 0);
    await page
      .getByRole("button", { name: "Edit text: Selected text", exact: true })
      .click();
    assert.equal(
      (await snapshot()).sheet,
      "crop",
      "Text selection keeps Transform open instead of opening its composer",
    );
    const text = page.getByRole("button", {
      name: "Edit text: Selected text",
      exact: true,
    });
    await text.press("+");
    assert(
      await page.evaluate(
        () =>
          !!window.sharedTransform.useCapture.getState().texts[0].animation
            ?.tracks.scaleX?.length,
      ),
    );
    const canvas = await page.locator(".pvBox").boundingBox();
    await page.mouse.click(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height * 0.52,
    );
    await page.getByRole("region", { name: "Crop", exact: true }).waitFor();
    assert.equal(
      (await snapshot()).sel,
      0,
      "Tapping the video switches back inside the same tool",
    );
    const afterComponent = (await snapshot()).component;
    await page
      .getByRole("group", { name: "Transform video", exact: true })
      .press("+");
    assert.deepEqual((await snapshot()).component, afterComponent);
    // Timeline and external selection share the same flow; switching during a drag cancels it.
    await page.evaluate(() => {
      const api = window.sharedTransform;
      api.selectTimelineLayer(`component:${api.id}`);
    });
    assert.equal((await snapshot()).sheet, "crop");
    const beforeSwitch = await snapshot();
    point = await center();
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 8, point.y + 8, { steps: 5 });
    await page.evaluate(() =>
      window.sharedTransform.selectTimelineLayer("video"),
    );
    await page.mouse.up();
    assert.deepEqual((await snapshot()).component, beforeSwitch.component);
    assert.equal((await snapshot()).past, beforeSwitch.past);
    assert.equal((await snapshot()).sheet, "crop");
    await context.close();
    console.log(
      `${width}×${height} ${theme}: shared selection, move/scale/rotate, text, Undo/Redo and cancellation passed.`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
