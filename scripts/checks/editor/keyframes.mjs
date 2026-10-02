import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

// Isolated synthetic layers exercise public authoring controls without AI calls.
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
page.setDefaultTimeout(12000);
const controls = () =>
  page.locator("[data-keyframe-editor]").filter({ visible: true });
const history = () =>
  page.evaluate(() => window.keyframeCheck.useCapture.getState().past.length);
const animation = (kind) =>
  page.evaluate((kind) => {
    const state = window.keyframeCheck.useCapture.getState();
    const list =
      kind === "clip"
        ? state.clips
        : kind === "audio"
          ? state.audioClips
          : kind === "component"
            ? state.components
            : state.texts;
    return kind === "music"
      ? state.scenes[0].musicAnimation
      : list[0].animation;
  }, kind);
const select = async (kind, time = 0) => {
  await page.evaluate(
    ({ kind, time }) => {
      const state = window.keyframeCheck.useCapture.getState();
      state.patch({
        sel: -1,
        selText: null,
        selComp: null,
        selAudio: null,
        sheet: null,
        t: time,
        playing: false,
        ...(kind === "clip"
          ? { sel: 0 }
          : kind === "text"
            ? { selText: 7 }
            : kind === "audio"
              ? { selAudio: 8 }
              : kind === "component"
                ? {
                    selComp: window.keyframeCheck.componentId,
                    sheet: "component",
                  }
                : { sheet: "sound" }),
      });
    },
    { kind, time },
  );
  if (await page.locator("[data-desktop-editor]").count()) {
    if (kind === "component")
      await page.getByRole("tab", { name: "Look", exact: true }).click();
    if (kind === "text")
      await page.getByRole("tab", { name: "Style", exact: true }).click();
    if (kind === "clip")
      await page.getByRole("tab", { name: "Video", exact: true }).click();
  }
};
const undo = async () => {
  const state = await page.evaluate(() => ({
    past: window.keyframeCheck.useCapture.getState().past.length,
  }));
  if (await page.locator("[data-desktop-timeline]").count())
    await page
      .getByRole("button", { name: "Undo · Ctrl/⌘ Z", exact: true })
      .click();
  else {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Meta+z");
  }
  assert.equal(await history(), state.past - 1);
};
const dragTo = async (locator, fraction) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, {
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
    useCapture.setState(initial());
    const clip = {
      id: 1,
      url: null,
      color: "#4d4257",
      srcDur: 10,
      in: 1,
      out: 9,
      speed: 2,
      zoom: 1,
      mirror: false,
      width: 720,
      height: 1280,
      fit: "cover",
    };
    const text = {
      id: 7,
      text: "Animated title",
      color: 0,
      start: 0,
      end: 4,
      x: 50,
      y: 50,
    };
    const audio = {
      id: 8,
      name: "Sound",
      url: null,
      srcDur: 10,
      in: 1,
      out: 9,
      speed: 2,
      start: 0,
      muted: false,
      gain: 1,
    };
    useCapture.getState().patch({
      screen: "editor",
      clips: [clip],
      texts: [text],
      audioClips: [audio],
      sound: 1,
      sel: -1,
      selText: 7,
      t: 0,
      sheet: null,
    });
    const componentId = useCapture.getState().addComponent("tooltip");
    useCapture
      .getState()
      .updateComponent(componentId, { at: 0, dur: 4, x: 50, y: 65 });
    useCapture.getState().patch({
      past: [],
      future: [],
      sel: -1,
      selText: 7,
      selComp: null,
      sheet: null,
    });
    window.keyframeCheck = { useCapture, componentId };
    const { navigateProject } = await import("/src/app/navigation.ts");
    const projectId = crypto.randomUUID();
    useCapture.getState().patch({ localId: projectId });
    navigateProject(projectId, true);
    await document.fonts.ready;
  });

  for (const kind of ["text", "clip", "component", "audio", "music"]) {
    await select(kind, 1);
    await controls().waitFor();
    const audio = kind === "audio" || kind === "music";
    const name = audio ? "Volume" : "Scale";
    const before = await history();
    await controls()
      .getByRole("button", { name: `Add ${name} keyframe`, exact: true })
      .click();
    assert.equal(
      await history(),
      before + 1,
      `${kind}: property diamond adds one history step`,
    );
    const expectedClock = kind === "clip" || kind === "audio" ? 3 : 1;
    const property = audio ? "gain" : "scaleX";
    assert.equal(
      (await animation(kind)).tracks[property][0].time,
      expectedClock,
      `${kind}: canonical source/local clock is preserved`,
    );
    const slider = controls().getByRole("slider", { name, exact: true });
    await slider.focus();
    await slider.press(audio ? "Home" : "End");
    assert.equal(
      (await animation(kind)).tracks[property][0].value,
      audio ? 0 : 2,
      `${kind}: slider edits actual animation`,
    );
    const after = await history();
    await slider.press(audio ? "Home" : "End");
    assert.equal(
      await history(),
      after,
      `${kind}: unchanged slider input is not another Undo`,
    );
    await undo();
    await select(kind, 1);
    await page
      .locator(`[data-keyframe-lane="${audio ? "volume" : "scale"}"]`)
      .getByRole("button", { name: `${name} keyframe at 0:01.0`, exact: true })
      .click();
    assert.equal(
      (await animation(kind)).tracks[property][0].value,
      1,
      `${kind}: Undo restores prior key value`,
    );
    await controls()
      .getByRole("button", { name: "Slow down", exact: true })
      .click();
    assert.equal(
      (await animation(kind)).tracks[property][0].easing,
      "ease-out",
      `${kind}: easing chips edit outgoing interpolation`,
    );
  }
  await select("clip", 2);
  await page
    .locator("[data-desktop-inspector]")
    .getByRole("tab", { name: "Audio", exact: true })
    .click();
  await controls()
    .getByRole("button", { name: "Add Volume keyframe", exact: true })
    .click();
  assert.equal(
    (await animation("clip")).tracks.gain[0].time,
    5,
    "Video audio tab edits clip gain using source seconds",
  );

  await select("text", 2);
  const scale = controls().getByRole("slider", { name: "Scale", exact: true });
  const beforeDrag = await history();
  await dragTo(scale, 0.8);
  assert.equal(
    await history(),
    beforeDrag + 1,
    "Desktop slider multi-event gesture is atomic",
  );
  assert.ok(
    (await animation("text")).tracks.scaleX.some((key) => key.time === 2),
    "Slider between keys inserts an evaluated key",
  );
  await controls()
    .getByRole("button", { name: "Previous Scale keyframe", exact: true })
    .click();
  assert.equal(
    await history(),
    beforeDrag + 1,
    "Previous-key navigation doesn't edit history",
  );
  await controls()
    .getByRole("button", { name: "Next Scale keyframe", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.keyframeCheck.useCapture.getState().t),
    2,
  );
  await mkdir("/tmp/pvo-keyframes-check", { recursive: true });
  await page.screenshot({ path: "/tmp/pvo-keyframes-check/desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await select("text", 3);
  await page.getByRole("button", { name: "Animate", exact: true }).click();
  const sheet = page.locator("[data-animation-sheet]");
  await sheet.waitFor();
  const beforePhone = await history();
  await sheet.getByRole("button", { name: "Keyframe", exact: true }).click();
  assert.equal(
    await history(),
    beforePhone + 1,
    "Phone Keyframe is one whole-transform edit",
  );
  for (const property of [
    "x",
    "y",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity",
  ]) {
    assert.ok(
      (await animation("text")).tracks[property].some((key) => key.time === 3),
      `Phone captures ${property} at the same moment`,
    );
  }
  const pad = sheet.getByRole("group", { name: "Position pad", exact: true });
  const box = await pad.boundingBox();
  const beforePad = await history();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3, {
    steps: 8,
  });
  await page.mouse.up();
  assert.equal(
    await history(),
    beforePad + 1,
    "Phone pad commits one Undo step",
  );
  assert.ok(
    Math.abs(
      (await animation("text")).tracks.x.find((key) => key.time === 3).value -
        25,
    ) < 1,
    "Position pad writes real normalized movement",
  );
  await sheet.getByRole("button", { name: "Jump", exact: true }).click();
  for (const property of [
    "x",
    "y",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity",
  ]) {
    assert.equal(
      (await animation("text")).tracks[property].find((key) => key.time === 3)
        .easing,
      "hold",
      "Phone easing covers the whole transform at that moment",
    );
  }
  const ribbonKey = sheet.getByRole("button", {
    name: "Keyframe at 0:03.0",
    exact: true,
  });
  const keyBox = await ribbonKey.boundingBox();
  const ribbon = await sheet
    .getByLabel("Animation timeline", { exact: true })
    .boundingBox();
  const beforeMove = await history();
  await page.mouse.move(
    keyBox.x + keyBox.width / 2,
    keyBox.y + keyBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    keyBox.x + keyBox.width / 2 + ribbon.width * 0.125,
    keyBox.y + keyBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.equal(
    await history(),
    beforeMove + 1,
    "Phone ribbon movement is one Undo",
  );
  assert.equal(
    await page.evaluate(() => window.keyframeCheck.useCapture.getState().t),
    3.5,
    "Ribbon keeps the playhead at the new key time",
  );
  for (const property of [
    "x",
    "y",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity",
  ]) {
    assert.ok(
      (await animation("text")).tracks[property].some(
        (key) => key.time === 3.5,
      ),
      "Phone ribbon moves every transform curve together",
    );
  }
  await undo();
  assert.ok(
    (await animation("text")).tracks.x.some((key) => key.time === 3),
    "Phone Undo restores the complete moment",
  );
  await page.screenshot({ path: "/tmp/pvo-keyframes-check/mobile.png" });
  await sheet
    .getByRole("button", { name: "Close Animate", exact: true })
    .click();
  await select("audio", 1);
  await page.getByRole("button", { name: "Animate", exact: true }).click();
  await sheet
    .getByRole("button", { name: "Fade in · 0.8s", exact: true })
    .click();
  const fade = (await animation("audio")).tracks.gain;
  assert.equal(
    fade.find((key) => key.time === 1).value,
    0,
    "Fade begins at source in-point",
  );
  assert.ok(
    fade.some((key) => Math.abs(key.time - 2.6) < 1e-6 && key.value === 1),
    "0.8s scene fade respects speed 2 source clock",
  );
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(
    "Manual keyframes: all five layer kinds, desktop property controls, source clocks, easing, sliders, no-op history, phone whole-transform pad/ribbon/Undo and audio fades passed.",
  );
} catch (error) {
  await page.screenshot({ path: "/tmp/keyframes-failure.png" });
  console.error("Keyframe diagnostics", errors);
  throw error;
} finally {
  await browser.close();
}
