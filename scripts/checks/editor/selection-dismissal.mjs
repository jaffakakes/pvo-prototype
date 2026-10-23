import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const browser = await launchBrowser();
let page;
try {
  page = await browser.newPage({
    viewport: { width: 390, height: 850 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/");
  await page.evaluate(
    async (media) => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const { initial } = await import("/src/state/project/initial.ts");
      useCapture.setState(initial());
      const url = URL.createObjectURL(
        await (await fetch(`/@fs/${media}`)).blob(),
      );
      useCapture.getState().patch({
        screen: "editor",
        clips: [mkClip(4, url, 0)],
        sel: -1,
        sheet: null,
      });
      useCapture.getState().addText("Selection test");
      useCapture.getState().addComponent("card");
      useCapture
        .getState()
        .patch({ sheet: null, sel: -1, selText: null, selComp: null });
      window.selectionCheck = useCapture;
    },
    fileURLToPath(
      new URL("../../../share/assets/preview.mp4", import.meta.url),
    ).replaceAll("\\", "/"),
  );
  const tools = page.locator(".toolBar");
  const main = () =>
    tools.getByRole("button", { name: "Edit clip", exact: true }).waitFor();
  const layer = (kind) =>
    page
      .locator(`[data-reorder-layer${kind === "video" ? "=" : "^="}'${kind}']`)
      .first();
  const selected = () =>
    page.waitForFunction(() => {
      const s = window.selectionCheck.getState();
      return (
        s.sel >= 0 ||
        s.selText !== null ||
        s.selComp !== null ||
        s.selAudio !== null
      );
    });
  const blankPreview = async () => {
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    const box = await page.locator(".previewArea").boundingBox();
    await page.touchscreen.tap(box.x + 3, box.y + 3);
  };
  await main();
  for (const kind of ["video", "text:", "component:"]) {
    await layer(kind).tap();
    await selected();
    await blankPreview();
    await main();
    await layer(kind).tap();
    const toolbar = await tools.boundingBox();
    await page.touchscreen.tap(toolbar.x + 2, toolbar.y + 2);
    await main();
    await layer(kind).tap();
    const timeline = await page.locator(".tl").boundingBox();
    await page.touchscreen.tap(timeline.x + 250, timeline.y + 12);
    await main();
  }
  await layer("text:").tap();
  await layer("component:").tap();
  await tools.getByRole("button", { name: "Opacity", exact: true }).tap();
  await page.getByRole("slider", { name: "Opacity", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close sheet", exact: true }).tap();
  await tools.getByRole("button", { name: "Opacity", exact: true }).waitFor();
  await blankPreview();
  await main();
  await layer("video").tap();
  await tools.getByRole("button", { name: "Speed", exact: true }).tap();
  const speed = page.getByRole("region", { name: "Speed", exact: true });
  await speed.getByRole("button", { name: "1.5×", exact: true }).tap();
  assert(await speed.isVisible(), "Tray controls remain usable");
  assert.equal(
    await page.evaluate(() => window.selectionCheck.getState().clips[0].speed),
    1.5,
  );
  await blankPreview();
  await main();
  assert.equal(await page.locator("[data-tool-tray]").count(), 0);
  await layer("video").tap();
  await tools.getByRole("button", { name: "Speed", exact: true }).tap();
  await page.keyboard.press("Escape");
  await tools.getByRole("button", { name: "Split", exact: true }).waitFor();
  await blankPreview();
  await main();
  await layer("text:").tap();
  await tools.getByRole("button", { name: "Edit text", exact: true }).tap();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Hide keyboard", exact: true }).tap();
  await page.getByRole("button", { name: "Close sheet", exact: true }).tap();
  await tools.getByRole("button", { name: "Edit text", exact: true }).waitFor();
  await blankPreview();
  await main();
  await layer("text:").tap();
  const box = await page.locator(".previewArea").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 3, y: box.y + 3 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: box.x + 10, y: box.y + 3 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await main();
  await layer("video").tap();
  await tools.getByRole("button", { name: "Extract audio", exact: true }).tap();
  await tools.getByRole("button", { name: "Mute", exact: true }).waitFor();
  await blankPreview();
  await main();
  console.log(
    "Selection dismissal passed: current clip/text/component/audio controls, Speed tray, sheet close, Escape, outside taps and touch jitter.",
  );
} catch (error) {
  console.error(
    "Isolated selection fixture:",
    await page?.evaluate(() => {
      const { sheet, sel, selText, selComp } =
        window.selectionCheck?.getState() ?? {};
      return {
        sheet,
        sel,
        selText,
        selComp,
        active: document.activeElement?.getAttribute("aria-label"),
        buttons: [...document.querySelectorAll("button")]
          .filter((node) => node.getBoundingClientRect().width > 0)
          .map((node) => node.getAttribute("aria-label") || node.textContent),
      };
    }),
  );
  throw error;
} finally {
  await browser.close();
}
