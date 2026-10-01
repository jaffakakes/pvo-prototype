import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const chromePath =
  process.env.CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15_000);

const desktopTimeline = page.locator("[data-desktop-timeline]");

function close(actual, expected, message, tolerance = 0.03) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

async function seedMobileFixture() {
  return page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const clip = {
      id: 1,
      url: new URL("/samples/restyle-sample.mp4", location.href).href,
      color: "#594066",
      srcDur: 7.9,
      in: 0,
      out: 7.9,
      speed: 1,
      zoom: 1,
      mirror: false,
      width: 720,
      height: 1280,
      fit: "cover",
    };
    const scene = {
      id: "main",
      name: "Main",
      parent: null,
      clips: [clip],
      audioClips: [],
      texts: [],
      components: [],
      muted: false,
      sound: 0,
      layers: ["video"],
    };
    useCapture.getState().patch({
      scenes: [scene],
      currentSceneId: "main",
      clips: [clip],
      audioClips: [],
      texts: [],
      components: [],
      layers: ["video"],
      screen: "editor",
      sel: -1,
      selComp: null,
      selText: null,
      selAudio: null,
      sheet: null,
      t: 0,
      playing: false,
      past: [],
      future: [],
    });
    const first = useCapture.getState().addComponent("tooltip");
    const second = useCapture.getState().addComponent("message");
    const third = useCapture.getState().addComponent("choice");
    for (const id of [first, second, third])
      useCapture.getState().updateComponent(id, { at: 0, dur: 3 }, false);
    useCapture.getState().patch({
      selComp: null,
      sheet: null,
      past: [],
      future: [],
    });
    window.timelineLayerStackCapture = useCapture;
    return { first, second, third };
  });
}

async function assertSeparateMobileRows() {
  const result = await page.locator(".tl").evaluate((timeline) => {
    const boxes = (selector, attribute) =>
      [...timeline.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute(attribute),
          top: box.top,
          bottom: box.bottom,
        };
      });
    return {
      bars: boxes('[data-layer-id^="component:"]', "data-layer-id"),
      labels: boxes(
        '[data-reorder-layer^="component:"]',
        "data-reorder-layer",
      ),
      videoTop: timeline
        .querySelector('[data-layer-id="video"]')
        .getBoundingClientRect().top,
    };
  });

  assert.equal(result.bars.length, 3);
  assert.deepEqual(
    result.labels.map((row) => row.id),
    result.bars.map((row) => row.id).reverse(),
    "Mobile labels must follow the same front-to-back stack as the timing rows",
  );
  const ordered = result.bars.slice().sort((left, right) => left.top - right.top);
  for (let index = 1; index < ordered.length; index += 1)
    assert(
      ordered[index].top >= ordered[index - 1].bottom,
      `Mobile component rows overlap at ${ordered[index].id}`,
    );
  assert(
    ordered.at(-1).bottom <= result.videoTop,
    "Mobile component rows must remain separate from the video row",
  );
}

async function configureDesktopPacking(ids) {
  const text = await page.evaluate(({ first, second, third }) => {
    const state = window.timelineLayerStackCapture.getState();
    state.updateComponent(first, { at: 0, dur: 2 }, false);
    state.updateComponent(second, { at: 2, dur: 2 }, false);
    state.updateComponent(third, { at: 1, dur: 2 }, false);
    const textId = window.timelineLayerStackCapture
      .getState()
      .addText("Packing text");
    window.timelineLayerStackCapture
      .getState()
      .updateText(textId, { start: 4, end: 6 }, false);
    window.timelineLayerStackCapture.getState().patch({
      t: 0,
      sel: -1,
      selComp: null,
      selText: null,
      sheet: null,
      playing: false,
      past: [],
      future: [],
    });
    return textId;
  }, ids);
  return { ...ids, text };
}

async function desktopGeometry(ids) {
  return desktopTimeline.evaluate((timeline, fixture) => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const lanes = [
      ...timeline.querySelectorAll(
        '[data-desktop-layer-lane^="overlay:front:"]',
      ),
    ].map((element) => ({
      id: element.getAttribute("data-desktop-layer-lane"),
      layerIds: (element.getAttribute("data-layer-ids") || "")
        .split(" ")
        .filter(Boolean),
      ...rect(element),
    }));
    const labels = Object.fromEntries(
      [...timeline.querySelectorAll("[data-desktop-layer-label]")].map(
        (element) => [
          element.getAttribute("data-desktop-layer-label"),
          rect(element),
        ],
      ),
    );
    const layerIds = {
      first: `component:${fixture.first}`,
      second: `component:${fixture.second}`,
      third: `component:${fixture.third}`,
      text: `text:${fixture.text}`,
    };
    const blocks = Object.fromEntries(
      Object.entries(layerIds).map(([name, layerId]) => [
        name,
        rect(timeline.querySelector(`[data-layer-id="${layerId}"]`)),
      ]),
    );
    const stack = timeline.querySelector("[data-desktop-visual-stack]");
    const audio = stack?.parentElement?.querySelector(
      ':scope > [data-kind="audio"]',
    );
    return {
      lanes,
      labels,
      blocks,
      stack: rect(stack),
      video: rect(
        timeline.querySelector('[data-desktop-layer-lane="video"]'),
      ),
      audio: rect(audio),
    };
  }, ids);
}

async function selectedLayer() {
  return page.evaluate(() => {
    const state = window.timelineLayerStackCapture.getState();
    return { selComp: state.selComp, selText: state.selText };
  });
}

async function componentTiming(id) {
  return page.evaluate((componentId) => {
    const state = window.timelineLayerStackCapture.getState();
    const component = state.components.find((item) => item.id === componentId);
    return {
      at: component?.at,
      dur: component?.dur,
      past: state.past.length,
      future: state.future.length,
    };
  }, id);
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const mobileFixture = await seedMobileFixture();
  await page.locator(".tl").waitFor();
  await assertSeparateMobileRows();

  await page.setViewportSize({ width: 320, height: 700 });
  await assertSeparateMobileRows();
  const preview = await page.locator(".pvBox").boundingBox();
  assert(
    preview && preview.height >= 100,
    "Stacked mobile rows must leave a usable preview on a small phone",
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("[data-desktop-editor]").waitFor();
  const fixture = await configureDesktopPacking(mobileFixture);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-desktop-layer-lane^="overlay:front:"]',
      ).length === 2,
  );

  const initial = await desktopGeometry(fixture);
  assert.deepEqual(
    initial.lanes.map((lane) => lane.id),
    ["overlay:front:0", "overlay:front:1"],
    "The desktop should use the two tracks required by maximum concurrency",
  );
  assert.deepEqual(initial.lanes[0].layerIds, [
    `component:${fixture.first}`,
    `component:${fixture.second}`,
    `text:${fixture.text}`,
  ]);
  assert.deepEqual(initial.lanes[1].layerIds, [
    `component:${fixture.third}`,
  ]);
  const overlayDomOrder = await desktopTimeline
    .locator("[data-desktop-visual-stack]")
    .evaluate((stack) =>
      [
        ...stack.querySelectorAll(
          '[data-layer-id^="component:"], [data-layer-id^="text:"]',
        ),
      ].map((element) => element.getAttribute("data-layer-id")),
    );
  assert.deepEqual(
    overlayDomOrder,
    [
      `component:${fixture.first}`,
      `component:${fixture.second}`,
      `text:${fixture.text}`,
      `component:${fixture.third}`,
    ],
    "Overlay DOM and keyboard order must follow packed row and time order",
  );
  close(
    initial.blocks.first.top,
    initial.blocks.second.top,
    "Touching component intervals should share a track",
    1,
  );
  close(
    initial.blocks.first.top,
    initial.blocks.text.top,
    "Non-overlapping component and text intervals should share a track",
    1,
  );
  assert(
    initial.blocks.third.top >= initial.blocks.first.bottom,
    "An overlapping component must use another track",
  );
  for (const lane of initial.lanes) {
    close(
      initial.labels[lane.id].top,
      lane.top,
      `Label ${lane.id} must align with its packed track`,
      1,
    );
  }
  assert(
    initial.video.top >= initial.lanes.at(-1).bottom,
    "The video row must remain below front overlay tracks",
  );
  close(
    initial.labels.video.top,
    initial.video.top,
    "The video label and row must align",
    1,
  );
  assert(
    initial.audio.top >= initial.stack.bottom,
    "Audio rows must remain after the packed visual stack",
  );

  for (const item of [
    { key: "first", kind: "component", id: fixture.first },
    { key: "third", kind: "component", id: fixture.third },
    { key: "text", kind: "text", id: fixture.text },
    { key: "second", kind: "component", id: fixture.second },
  ]) {
    await desktopTimeline
      .locator(
        `[data-layer-id="${item.kind === "text" ? "text" : "component"}:${item.id}"]`,
      )
      .click();
    const selection = await selectedLayer();
    assert.equal(
      item.kind === "text" ? selection.selText : selection.selComp,
      item.id,
      `${item.key} must remain selectable in its packed track`,
    );
  }

  const moving = desktopTimeline.locator(
    `[data-layer-id="component:${fixture.second}"]`,
  );
  const beforeDrag = await moving.boundingBox();
  assert(beforeDrag, "The moving component must have measurable geometry");
  const startX = beforeDrag.x + beforeDrag.width / 2;
  const startY = beforeDrag.y + beforeDrag.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 30, startY, { steps: 8 });
  await page.waitForFunction(
    (id) => {
      const component = window.timelineLayerStackCapture
        .getState()
        .components.find((item) => item.id === id);
      return component && Math.abs(component.at - 1.25) < 0.03;
    },
    fixture.second,
  );
  const during = await desktopGeometry(fixture);
  const duringTiming = await componentTiming(fixture.second);
  assert.equal(
    during.lanes.length,
    3,
    "Moving into two overlaps must repack to three tracks before release",
  );
  assert(
    Math.abs(during.blocks.second.top - beforeDrag.y) > 20,
    "The held block must move to its newly packed track",
  );
  close(duringTiming.at, 1.25, "The first held movement must update timing");
  assert.equal(duringTiming.past, 0, "Live repacking must not create history");

  await page.mouse.move(startX - 40, startY, { steps: 4 });
  await page.waitForFunction(
    (id) => {
      const component = window.timelineLayerStackCapture
        .getState()
        .components.find((item) => item.id === id);
      return component && Math.abs(component.at - 1) < 0.03;
    },
    fixture.second,
  );
  const beforeRelease = await componentTiming(fixture.second);
  close(
    beforeRelease.at,
    1,
    "Pointer capture must continue after the block changes tracks",
  );
  assert.equal(beforeRelease.past, 0);
  await page.mouse.up();
  const committed = await componentTiming(fixture.second);
  close(committed.at, 1, "Pointer release must keep the final drag timing");
  assert.equal(committed.past, 1, "The complete drag must create one undo step");

  await desktopTimeline.getByRole("button", { name: /^Undo/ }).click();
  await page.waitForFunction(
    (id) => {
      const component = window.timelineLayerStackCapture
        .getState()
        .components.find((item) => item.id === id);
      return component?.at === 2;
    },
    fixture.second,
  );
  const restored = await desktopGeometry(fixture);
  const restoredTiming = await componentTiming(fixture.second);
  assert.equal(restored.lanes.length, 2, "Undo must repack back to two tracks");
  close(
    restored.blocks.second.top,
    beforeDrag.y,
    "Undo must restore the original track",
    1,
  );
  assert.equal(restoredTiming.past, 0);

  const cancelBox = await moving.boundingBox();
  await page.mouse.move(
    cancelBox.x + cancelBox.width / 2,
    cancelBox.y + cancelBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + cancelBox.width / 2 - 30, startY, {
    steps: 8,
  });
  await page.waitForFunction(
    (id) => {
      const component = window.timelineLayerStackCapture
        .getState()
        .components.find((item) => item.id === id);
      return component && component.at < 1.3;
    },
    fixture.second,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForFunction(
    (id) => {
      const component = window.timelineLayerStackCapture
        .getState()
        .components.find((item) => item.id === id);
      return component?.at === 2;
    },
    fixture.second,
  );
  const cancelled = await desktopGeometry(fixture);
  const cancelledTiming = await componentTiming(fixture.second);
  assert.equal(cancelled.lanes.length, 2);
  close(
    cancelled.blocks.second.top,
    beforeDrag.y,
    "Escape must restore the pre-drag track",
    1,
  );
  assert.equal(cancelledTiming.past, 0, "A cancelled repack must add no history");

  assert.deepEqual(errors, [], "Layer packing should have no page errors");
  console.log(
    "PASS: desktop overlays pack and repack with continuous pointer capture; mobile keeps one row per layer.",
  );
} finally {
  await context.close();
  await browser.close();
}
