import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const url = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
const timeline = page.locator("[data-desktop-timeline]");
const inspector = page.locator("[data-desktop-inspector]");
const player = page.locator("[data-desktop-player]");
const width = page.getByRole("spinbutton", { name: "Width (px)", exact: true });
const height = page.getByRole("spinbutton", { name: "Height (px)", exact: true });
const clips = () => timeline.getByRole("button", { name: /^Clip \d+,/ });
const note = () => timeline.getByRole("button", { name: /^tooltip:/ });
const settle = () => page.waitForTimeout(350);

async function waitSaved(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const dimensions = await page.evaluate(async projectId => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("restyle-editor-project");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const record = await new Promise((resolve, reject) => {
          const request = database.transaction("checkpoints").objectStore("checkpoints").get(`project:${projectId}`);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const component = record?.project?.scenes?.flatMap(scene => scene.components).find(item => item.type === "tooltip");
        return component && { width: component.width, height: component.height };
      } finally { database.close(); }
    }, id);
    if (dimensions?.width === 420 && dimensions.height === 180) return;
    await page.waitForTimeout(100);
  }
  assert.fail("Pixel dimensions were not saved in the named project checkpoint");
}

async function checkFrame() {
  const result = await page.locator(".compOverlay").evaluate(element => {
    const overlay = element.getBoundingClientRect();
    const canvas = document.querySelector(".pvBox").getBoundingClientRect();
    return { width: overlay.width / canvas.width * 1080, height: overlay.height / canvas.width * 1080 };
  });
  assert(Math.abs(result.width - 420) < 4, `Expected 420 canvas pixels, got ${result.width}`);
  assert(Math.abs(result.height - 180) < 4, `Expected 180 canvas pixels, got ${result.height}`);
}

async function checkLayout(viewport) {
  await page.setViewportSize(viewport);
  await settle();
  const bounds = await page.locator("[data-desktop-library], [data-desktop-player], [data-desktop-inspector], [data-desktop-timeline]")
    .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
  assert.equal(bounds.length, 4);
  for (const box of bounds) {
    assert(box.x >= 0 && box.y >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
      `Panel outside ${viewport.width} × ${viewport.height}: ${JSON.stringify(box)}`);
  }
  assert(bounds[0].right < bounds[1].left && bounds[1].right < bounds[2].left);
  assert(bounds[3].top > bounds[0].bottom);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
  await checkFrame();
}

async function checkVisualLayerStack() {
  const result = await timeline.evaluate(element => {
    const labels = [...element.querySelectorAll("[data-desktop-layer-label]")];
    const lanes = [...element.querySelectorAll("[data-desktop-layer-lane]")];
    const geometry = nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return {
        id: node.getAttribute(nodes === labels
          ? "data-desktop-layer-label"
          : "data-desktop-layer-lane"),
        top: box.top,
        bottom: box.bottom,
      };
    });
    const tracks = labels[0]?.parentElement?.parentElement;
    const verticallyScrollable =
      !!tracks && tracks.scrollHeight > tracks.clientHeight;
    if (tracks) tracks.scrollTop = tracks.scrollHeight;
    const trackBox = tracks?.getBoundingClientRect();
    const labelGeometry = geometry(labels);
    const laneGeometry = geometry(lanes);
    const finalLane = laneGeometry.at(-1);
    return {
      labels: labelGeometry,
      lanes: laneGeometry,
      verticallyScrollable,
      reachedBottom: !!tracks && tracks.scrollTop > 0,
      finalRowVisible:
        !!trackBox &&
        !!finalLane &&
        finalLane.top >= trackBox.top &&
        finalLane.bottom <= trackBox.bottom,
    };
  });

  assert.deepEqual(
    result.lanes.map(row => row.id),
    result.labels.map(row => row.id),
    "Layer labels and timing lanes must stay in the same stack order",
  );
  assert.deepEqual(
    result.lanes.map(row => row.id.split(":")[0]),
    ["text", "text", "text", "text", "component", "component", "video"],
    "Every visual item must get its own front-to-back timeline row",
  );
  for (let index = 0; index < result.lanes.length; index += 1) {
    assert(
      Math.abs(result.lanes[index].top - result.labels[index].top) < 1,
      `Layer row ${result.lanes[index].id} is not aligned with its label`,
    );
    if (index > 0)
      assert(
        result.lanes[index].top >= result.lanes[index - 1].bottom,
        `Layer rows overlap at ${result.lanes[index].id}`,
      );
  }
  assert.equal(
    result.verticallyScrollable,
    true,
    "A dense desktop layer stack must remain vertically reachable",
  );
  assert.equal(result.reachedBottom, true, "The desktop layer stack must scroll");
  assert.equal(
    result.finalRowVisible,
    true,
    "Scrolling must expose the final desktop layer row",
  );
}

try {
  await page.route("**/api/publishing", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ available: false, authenticated: false, maxBytes: 0 }) }));
  const home = new URL(url);
  home.search = "?home=1";
  await page.goto(home.href);
  await page.getByRole("button", { name: "Try a sample clip", exact: true }).click();
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await page.locator("[data-desktop-editor]").waitFor();
  await page.waitForFunction(() => document.querySelector(".pvVideo")?.readyState >= 2);
  const projectUrl = page.url();
  const projectId = new URL(projectUrl).searchParams.get("project");
  assert(projectId, "Desktop uses the shared saved-project route");
  await clips().first().click();
  await inspector.getByRole("tab", { name: "Speed", exact: true }).click();
  await inspector.getByRole("button", { name: "2×", exact: true }).click();
  assert.match(await clips().first().getAttribute("aria-label"), /4\.0 seconds/);
  await timeline.getByRole("button", { name: /^Undo/ }).click();
  assert.match(await clips().first().getAttribute("aria-label"), /7\.9 seconds/);
  await clips().first().click();
  await page.mouse.move(550, 650);
  await page.keyboard.press("s");
  assert.equal(await clips().count(), 2, "Keyboard uses the timeline Split command");
  await timeline.getByRole("button", { name: /^Undo/ }).click();
  assert.equal(await clips().count(), 1);

  await page.getByRole("tab", { name: "Components", exact: true }).click();
  await page.getByRole("button", { name: /Add a note/ }).click();
  await inspector.getByRole("tab", { name: "Look", exact: true }).click();
  await width.fill("420");
  await width.press("Enter");
  await height.fill("180");
  await height.press("Tab");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    await checkLayout(viewport);
    assert.equal(await width.inputValue(), "420");
    assert.equal(page.url(), projectUrl, "Resizing keeps the same project URL");
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 900, height: 700 }, { width: 1024, height: 1366 }]) {
    await page.setViewportSize(viewport);
    await page.locator(".editorWorkspace").waitFor();
    assert.equal(await page.locator("[data-desktop-editor]").count(), 0);
    assert.equal(await width.count(), 0, "Original narrow/portrait tools remain in use");
    assert.equal(page.url(), projectUrl);
    await settle();
    await checkFrame();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await width.waitFor();
  await waitSaved(projectId);
  await page.reload();
  await note().click();
  await inspector.getByRole("tab", { name: "Look", exact: true }).click();
  assert.equal(await width.inputValue(), "420");
  assert.equal(await height.inputValue(), "180");
  await settle();
  await checkFrame();
  console.log("PASS: layout, shared routes, real media, speed/split history, pixel size and save/reload.");

  await page.getByRole("button", { name: /Restyle assistant/ }).click();
  const input = page.getByRole("textbox", { name: "Describe a change" });
  await input.waitFor();
  const inputBounds = await input.boundingBox();
  assert(inputBounds.y >= 0 && inputBounds.x >= 0 && inputBounds.x + inputBounds.width <= 1440);
  assert.equal(await timeline.getByRole("button", { name: /^Delete selection/ }).isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await input.count(), 0);

  const ruler = timeline.getByLabel("Seek timeline", { exact: true });
  await ruler.click({ position: { x: 1, y: 10 } });
  await page.waitForFunction(() => document.querySelector(".pvVideo")?.currentTime < .15);
  await page.getByRole("tab", { name: "Components", exact: true }).click();
  await page.getByRole("button", { name: /Let viewers choose/ }).click();
  const playhead = timeline.locator("[data-desktop-playhead]");
  const choiceOverlay = page.locator(".compOverlay").filter({ hasText: "Which one?" });
  assert.equal(await choiceOverlay.count(), 1);

  await page.getByRole("tab", { name: "Text", exact: true }).click();
  for (const preset of ["Clean", "Headline", "Outline", "Label"])
    await page.getByRole("button", { name: `Add ${preset} text`, exact: true }).click();
  await checkVisualLayerStack();

  await player.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    const marker = document.querySelector("[data-desktop-playhead]");
    return video?.currentTime > .2 && Number.parseFloat(marker?.style.left ?? "0") > 8;
  });
  assert(Number.parseFloat(await playhead.evaluate(element => element.style.left)) > 8,
    "Normal playback did not advance the desktop playhead");
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await ruler.click({ position: { x: 1, y: 10 } });
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    return video && !video.seeking && video.currentTime < .15;
  });

  await player.getByRole("button", { name: "Try", exact: true }).click();
  assert.equal(await page.locator("[data-desktop-inspector]").evaluate(element => !!element.closest("[inert]")), true);
  await choiceOverlay.waitFor({ state: "detached", timeout: 8000 });
  const tryPlayback = await page.evaluate(() => ({
    videoTime: document.querySelector(".pvVideo")?.currentTime ?? 0,
    playheadTime: Number.parseFloat(document.querySelector("[data-desktop-playhead]")?.dataset.time ?? "0"),
  }));
  assert(tryPlayback.playheadTime > 2.8, "Try did not advance the desktop playhead past the component layer");
  assert(Math.abs(tryPlayback.videoTime - tryPlayback.playheadTime) < .25,
    `Try video and desktop playhead diverged: ${JSON.stringify(tryPlayback)}`);
  assert.equal(await player.getByRole("button", { name: "Stop trying", exact: true }).count(), 1,
    "Try stopped instead of continuing after the unanswered component ended");
  assert.equal(await page.locator(".pvVideo").evaluate(video => video.paused), false,
    "Video paused after a continuing component layer ended");
  await player.getByRole("button", { name: "Stop trying", exact: true }).click();
  assert.equal(await page.locator("[data-desktop-inspector]").evaluate(element => !!element.closest("[inert]")), false);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export to device", exact: true }).click();
  await page.getByRole("dialog", { name: "Export", exact: true }).waitFor();
  await page.getByRole("button", { name: /Interactive/ }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(page.url(), projectUrl);

  await page.getByRole("button", { name: "New scene branching from here", exact: true }).click();
  await page.getByText("Nothing here yet", { exact: true }).waitFor();
  const emptyLink = player.getByRole("button", { name: "Add clips from Media", exact: true });
  await emptyLink.click();
  assert.equal(await page.getByRole("tab", { name: "Media", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Add Clip 1 to timeline", exact: true }).click();
  assert.equal(await clips().count(), 1);
  await page.getByRole("button", { name: "Show the whole scene tree", exact: true }).click();
  assert.equal(await page.getByRole("tab", { name: "Scenes", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("PASS: assistant placement, stacked timeline rows, Try isolation, export dialog, empty scene import and scene navigation.");
} finally {
  await browser.close();
}
