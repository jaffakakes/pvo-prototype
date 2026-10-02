import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  serviceWorkers: "block",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error(message.text());
});
page.on("requestfailed", (request) =>
  console.error(request.url(), request.failure()?.errorText),
);
page.setDefaultTimeout(10000);
const lane = (group) => page.locator(`[data-keyframe-lane="${group}"]`);
const keys = (group) =>
  lane(group).getByRole("button", {
    name: new RegExp(
      `^${group === "position" ? "Position" : "Volume"} keyframe`,
    ),
  });
const snapshot = () =>
  page.evaluate(() => {
    const state = window.timelineCheck.useCapture.getState();
    return {
      past: state.past.length,
      text: state.texts[0],
      audio: state.audioClips[0],
      time: state.t,
      selected: window.timelineCheck.selection.getState().selection,
    };
  });
const scrub = async (time) => {
  const ruler = page.getByLabel("Seek timeline", { exact: true });
  const box = await ruler.boundingBox();
  await page.mouse.click(box.x + time * 40, box.y + 10);
};
const drag = async (locator, dx) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
};
try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Blank project", exact: true })
    .click();
  await page.locator("[data-desktop-player]").waitFor();
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const activeModule = (path) =>
      performance
        .getEntriesByType("resource")
        .find((entry) => new URL(entry.name).pathname === path)?.name || path;
    const { useAnimationSelection: selection } = await import(
      activeModule("/src/state/animation/selection.ts")
    );
    const { useAnimationSettings: settings } = await import(
      activeModule("/src/state/animation/settings.ts")
    );
    useCapture.setState(initial());
    const clip = {
      id: 1,
      url: null,
      color: "#4d4257",
      srcDur: 8,
      in: 0,
      out: 8,
      speed: 1,
      zoom: 1,
      mirror: false,
      width: 720,
      height: 1280,
      fit: "cover",
    };
    const text = {
      id: 7,
      text: "Timeline title",
      color: 0,
      start: 1,
      end: 5,
      x: 50,
      y: 50,
    };
    const audio = {
      id: 8,
      name: "Test sound",
      url: null,
      srcDur: 8,
      in: 0,
      out: 8,
      speed: 1,
      start: 0,
      muted: false,
      gain: 1,
    };
    useCapture.getState().patch({
      screen: "editor",
      clips: [clip],
      texts: [text],
      audioClips: [audio],
      sel: -1,
      selText: 7,
      selComp: null,
      t: 1,
      sheet: null,
      past: [],
      future: [],
    });
    window.timelineCheck = { useCapture, selection, settings };
    const { navigateProject } = await import("/src/app/navigation.ts");
    const projectId = crypto.randomUUID();
    useCapture.getState().patch({ localId: projectId });
    navigateProject(projectId, true);
    await document.fonts.ready;
  });
  const timeline = page.locator("[data-desktop-timeline]");
  await timeline.getByRole("button", { name: /^Add keyframe at/ }).click();
  await lane("position").waitFor();
  assert.equal(
    (await snapshot()).past,
    1,
    "Toolbar adds the first Position key in one Undo step",
  );
  assert.deepEqual(
    (await snapshot()).text.animation.tracks.x.map((key) => key.time),
    [0],
    "The 1s scene key uses layer-local time 0",
  );
  await scrub(3);
  await page.keyboard.press("k");
  assert.equal(
    await keys("position").count(),
    2,
    "K adds another editable timeline diamond",
  );
  assert.equal((await snapshot()).past, 2);
  const beforeClick = (await snapshot()).past;
  await keys("position").first().click();
  assert.equal(
    (await snapshot()).past,
    beforeClick,
    "Selecting a key does not create Undo",
  );
  assert.equal(
    (await snapshot()).time,
    1,
    "Selecting a key seeks to its scene time",
  );
  await drag(keys("position").first(), 2);
  assert.equal(
    (await snapshot()).past,
    beforeClick,
    "Motion below 3px does not edit",
  );
  await drag(keys("position").first(), 19);
  const moved = await snapshot();
  assert.equal(
    moved.past,
    beforeClick + 1,
    "A multi-event drag creates one Undo step",
  );
  assert.equal(
    moved.text.animation.tracks.x[0].time,
    0.5,
    "Drag snaps to .05 seconds",
  );
  assert.equal(moved.selected.time, 1.5);
  await page.keyboard.press("Meta+z");
  await page
    .getByRole("button", { name: "Text: Timeline title", exact: true })
    .click();
  assert.equal(
    (await snapshot()).text.animation.tracks.x[0].time,
    0,
    "Undo restores the original time",
  );
  await drag(keys("position").first(), 160);
  assert.equal(
    (await snapshot()).text.animation.tracks.x[0].time,
    1.9,
    "Neighbour spacing remains at least .1s",
  );
  await page.keyboard.press("Meta+z");
  await page
    .getByRole("button", { name: "Text: Timeline title", exact: true })
    .click();
  await keys("position").first().click();
  await timeline
    .getByRole("button", { name: "Delete keyframe · Backspace", exact: true })
    .click();
  assert.equal(
    (await snapshot()).text.animation.tracks.x.length,
    1,
    "Contextual toolbar Delete removes a key",
  );
  assert.equal(
    (await snapshot()).text.text,
    "Timeline title",
    "Contextual Delete keeps the layer",
  );
  await page.keyboard.press("Meta+z");
  await page
    .getByRole("button", { name: "Text: Timeline title", exact: true })
    .click();
  await keys("position").last().click();
  await page.keyboard.press("Backspace");
  assert.equal(
    (await snapshot()).text.animation.tracks.x.length,
    1,
    "Keyboard Delete shares key-first command",
  );
  await page.keyboard.press("Meta+z");
  await page
    .getByRole("button", { name: "Text: Timeline title", exact: true })
    .click();
  await lane("position")
    .getByRole("button", { name: /^Edit easing after/ })
    .click();
  assert.equal(
    (await snapshot()).selected.group,
    "position",
    "Easing pill selects the segment's outgoing key",
  );
  await scrub(4);
  assert.equal(
    (await snapshot()).selected,
    null,
    "Ruler scrubbing clears key selection",
  );
  assert.equal((await snapshot()).time, 4);

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 960 : 768 });
    const row = await lane("position").boundingBox();
    const label = await page
      .locator('[data-keyframe-lane-label="position"]')
      .boundingBox();
    assert.ok(
      Math.abs(row.y - label.y) < 1,
      `Property row and header align at ${width}px`,
    );
    assert.ok(
      row.y + row.height <=
        (await timeline.boundingBox()).y +
          (await timeline.boundingBox()).height,
      `Lane is visible at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() =>
    window.timelineCheck.settings.getState().setLaneMode("single"),
  );
  await lane("all").waitFor();
  assert.equal(
    await lane("position").count(),
    0,
    "Single mode combines the property presentation",
  );
  await page.evaluate(() =>
    window.timelineCheck.settings.getState().setLaneMode("properties"),
  );
  await page
    .getByRole("button", { name: "Test sound, 8.0 seconds", exact: true })
    .click();
  await scrub(1);
  await page.keyboard.press("k");
  await lane("volume").waitFor();
  await scrub(4);
  await page.keyboard.press("k");
  assert.equal(
    await keys("volume").count(),
    2,
    "Audio gets its own volume lane",
  );
  assert.equal(
    await timeline.locator("[data-volume-envelope] rect").count(),
    2,
    "Audio bar renders real volume keys",
  );
  const audioRow = await lane("volume").boundingBox();
  const audioLabel = await page
    .locator('[data-keyframe-lane-label="volume"]')
    .boundingBox();
  assert.ok(
    Math.abs(audioRow.y - audioLabel.y) < 1,
    "Audio property header aligns with its row",
  );
  await page
    .getByRole("button", { name: "Text: Timeline title", exact: true })
    .click();
  await page.evaluate(() =>
    window.timelineCheck.useCapture.getState().patch({ sheet: null }),
  );
  await mkdir("/tmp/pvo-keyframe-timeline", { recursive: true });
  await page.screenshot({ path: "/tmp/pvo-keyframe-timeline/desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const overview = page
    .locator("[data-timeline-keyframes]")
    .filter({ visible: true })
    .first();
  await overview.waitFor();
  const size = await overview
    .locator("b")
    .first()
    .evaluate((element) => ({
      width: getComputedStyle(element).width,
      height: getComputedStyle(element).height,
    }));
  assert.deepEqual(
    size,
    { width: "14px", height: "14px" },
    "Phone bars use the supplied 14px read-only diamonds",
  );
  await page.screenshot({ path: "/tmp/pvo-keyframe-timeline/mobile.png" });
  assert.deepEqual(errors, [], "No runtime errors");
  console.log(
    "Keyframe timeline: toolbar/K, click vs drag, snapping, neighbour clamp, atomic Undo, contextual Delete, easing selection, ruler seek, desktop alignment, audio envelope and phone markers passed.",
  );
} catch (error) {
  console.error(
    "Browser diagnostics",
    errors,
    await page.locator("body").innerText(),
  );
  await page.screenshot({ path: "/tmp/keyframe-timeline-failure.png" });
  throw error;
} finally {
  await browser.close();
}
