import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const browser = await launchBrowser({
  headless: true,
});
const media = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
).replaceAll("\\", "/");
const errors = [];
try {
  for (const [width, height] of [
    [393, 852],
    [320, 568],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/");
    await page.evaluate(async (media) => {
      const { useCapture } = await import("/src/state/captureStore.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      useCapture.setState(initial());
      const url = URL.createObjectURL(
        await (await fetch(`/@fs/${media}`)).blob(),
      );
      useCapture.getState().patch({
        screen: "editor",
        sel: 0,
        t: 1,
        clips: [
          {
            id: 1,
            url,
            color: "#4d4257",
            srcDur: 4,
            in: 0,
            out: 4,
            speed: 1,
            zoom: 1,
            mirror: false,
            width: 720,
            height: 1280,
            fit: "cover",
          },
        ],
      });
      window.cropCheck = { useCapture };
      await document.fonts.ready;
    }, media);
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    const surface = page.getByRole("group", {
      name: "Transform video",
      exact: true,
    });
    await surface.waitFor();
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const box = await surface.boundingBox();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const snapshot = () =>
      page.evaluate(() => {
        const state = window.cropCheck.useCapture.getState();
        return {
          clip: JSON.parse(JSON.stringify(state.clips[0])),
          past: state.past.length,
          sheet: state.sheet,
        };
      });
    const frames = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    const values = (state) => {
      const tracks = state.clip.animation?.tracks ?? {};
      return {
        scale: tracks.scaleX?.[0]?.value ?? 1,
        rotation: tracks.rotation?.[0]?.value ?? 0,
        x: tracks.x?.[0]?.value ?? 0,
        y: tracks.y?.[0]?.value ?? 0,
      };
    };
    const touch = (type, touchPoints) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const pinch = async ({
      factor = 1.4,
      degrees = 30,
      cancel = false,
      continueDrag = false,
    } = {}) => {
      const points = (progress) =>
        [0, 1].map((id) => {
          const distance = 14 * (1 + (factor - 1) * progress) * (id ? 1 : -1);
          const angle = (degrees * progress * Math.PI) / 180;
          return {
            id,
            x: center.x + distance * Math.cos(angle) + 6 * progress,
            y: center.y + distance * Math.sin(angle) + 4 * progress,
          };
        });
      await touch("touchStart", points(0));
      for (let step = 1; step <= 12; step++)
        await touch("touchMove", points(step / 12));
      await frames();
      if (continueDrag) {
        const beforeLift = values(await snapshot());
        await touch("touchEnd", [points(1)[1]]);
        await frames();
        assert.deepEqual(
          values(await snapshot()),
          beforeLift,
          "Lifting one finger must not jump the video",
        );
        const remaining = points(1)[0];
        await touch("touchMove", [
          { ...remaining, x: remaining.x + 5, y: remaining.y + 4 },
        ]);
        await frames();
        const after = values(await snapshot());
        assert.equal(after.scale, beforeLift.scale);
        assert.equal(after.rotation, beforeLift.rotation);
        assert(
          after.x > beforeLift.x && after.y > beforeLift.y,
          "One remaining finger continues the drag",
        );
      }
      await touch(cancel ? "touchCancel" : "touchEnd", []);
      await frames();
      assert.equal(
        await page.evaluate(() => visualViewport.scale),
        1,
        "The page itself must not pinch-zoom",
      );
    };
    const baseline = await snapshot();
    await page.mouse.click(center.x, center.y);
    assert.deepEqual(
      await snapshot(),
      baseline,
      "A tap leaves no crop keys or history",
    );
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 1, center.y + 1);
    await page.mouse.up();
    assert.deepEqual(
      await snapshot(),
      baseline,
      "A little finger jitter leaves no crop keys or history",
    );
    await pinch();
    const transformed = await snapshot();
    assert.equal(
      transformed.past,
      baseline.past + 1,
      "One pinch/twist is one Undo",
    );
    assert(Math.abs(values(transformed).scale - 1.4) < 0.01);
    assert(Math.abs(values(transformed).rotation - 30) < 0.1);
    const painted = await page
      .locator('.pvBox [data-layer-id="video"]')
      .evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return {
          scale: Math.hypot(matrix.a, matrix.b),
          rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
        };
      });
    assert(
      Math.abs(painted.scale - 1.4) < 0.01 &&
        Math.abs(painted.rotation - 30) < 0.1,
      "The preview paints the saved transform",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual((await snapshot()).clip, baseline.clip);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    assert.deepEqual((await snapshot()).clip, transformed.clip);
    await pinch({ factor: 0.7, degrees: -20, cancel: true });
    assert.deepEqual(
      await snapshot(),
      transformed,
      "Cancelled touches restore every curve without history",
    );
    await pinch({ factor: 1.1, degrees: 5, continueDrag: true });
    assert.equal(
      (await snapshot()).past,
      transformed.past + 1,
      "Two-to-one-finger continuation stays one transaction",
    );
    const tray = page.getByRole("region", { name: "Crop", exact: true });
    await tray
      .getByRole("slider", { name: "Opacity", exact: true })
      .press("ArrowLeft");
    assert.equal(
      (await snapshot()).clip.animation.tracks.opacity[0].value,
      0.99,
    );
    await tray.getByRole("button", { name: "Reset", exact: true }).click();
    assert.equal(
      (await snapshot()).clip.animation,
      undefined,
      "Reset clears touch transforms and opacity",
    );
    await surface.press("+");
    assert.equal(
      values(await snapshot()).scale,
      1.01,
      "Keyboard scaling remains available without a Zoom slider",
    );
    await surface.press("]");
    assert.equal(values(await snapshot()).rotation, 1);
    await tray.getByRole("button", { name: "Reset", exact: true }).click();
    const corner = await page
      .locator('[data-crop-handle="top-left"]')
      .boundingBox();
    if (box.width >= 96 && box.height >= 96) {
      await page.mouse.move(corner.x + 12, corner.y + 12);
      await page.mouse.down();
      await page.mouse.move(corner.x - 10, corner.y - 10, { steps: 8 });
      await page.mouse.up();
      assert(
        values(await snapshot()).scale > 1.05,
        "Mouse corner dragging scales the video",
      );
    } else {
      assert.equal(
        await page
          .locator('[data-crop-handle="top-left"]')
          .getAttribute("aria-hidden"),
        "true",
        "Tiny previews keep decorative corners clear of touch gestures",
      );
    }
    const beforeCancel = await snapshot();
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 8, center.y + 8, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(
      await snapshot(),
      beforeCancel,
      "Escape cancels the live crop and keeps Crop open",
    );
    await page.mouse.move(center.x + 16, center.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(center.x, center.y + 16, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    assert(
      Math.abs(values(await snapshot()).rotation) > 30,
      "Alt-drag rotates with a mouse",
    );
    const beforeClose = await snapshot();
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x - 9, center.y - 7, { steps: 5 });
    // The pointer is captured by the preview. Unmount directly to cover navigation
    // or another control closing the tool while that contact is still held.
    await page.evaluate(() =>
      window.cropCheck.useCapture.getState().patch({ sheet: null, sel: -1 }),
    );
    await surface.waitFor({ state: "hidden" });
    await page.mouse.up();
    const afterClose = await snapshot();
    assert.equal(afterClose.sheet, null);
    assert.deepEqual(
      afterClose.clip,
      beforeClose.clip,
      "Unmounting Crop cancels its in-flight preview",
    );
    assert.equal(afterClose.past, beforeClose.past);
    await context.close();
    console.log(
      `${width}×${height}: crop pinch/twist/drag, preview, Undo/Redo, cancellation, mouse and keyboard passed.`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
