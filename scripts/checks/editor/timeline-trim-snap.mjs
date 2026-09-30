import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const chromePath =
  process.env.CHROME_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "C:/Program Files/Google/Chrome/Application/chrome.exe");
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);

const timeline = page.locator("[data-desktop-timeline]");
const playhead = timeline.locator("[data-desktop-playhead]");
const undo = timeline.getByRole("button", { name: /^Undo/ });

async function timingState() {
  return page.evaluate(() => {
    const state = window.timelineSnapCapture.getState();
    const fixture = window.timelineSnapFixture;
    const component = state.components.find((item) => item.id === fixture.componentId);
    const text = state.texts.find((item) => item.id === fixture.textId);
    const audio = state.audioClips.find((item) => item.id === fixture.audioId);
    return {
      playhead: state.t,
      past: state.past.length,
      clip: state.clips[0] && {
        in: state.clips[0].in,
        out: state.clips[0].out,
        speed: state.clips[0].speed,
      },
      component: component && { at: component.at, dur: component.dur },
      text: text && { start: text.start, end: text.end },
      audio: audio && {
        start: audio.start,
        in: audio.in,
        out: audio.out,
        speed: audio.speed,
      },
    };
  });
}

function edgeTime(state, kind, side) {
  if (kind === "component")
    return side === "l"
      ? state.component.at
      : state.component.at + state.component.dur;
  if (kind === "text")
    return side === "l" ? state.text.start : state.text.end;
  if (kind === "audio")
    return side === "l"
      ? state.audio.start
      : state.audio.start +
          (state.audio.out - state.audio.in) / state.audio.speed;
  return (state.clip.out - state.clip.in) / state.clip.speed;
}

async function dragEdgeNearPlayhead(bar, side, candidateOffset = 5) {
  await bar.scrollIntoViewIfNeeded();
  await bar.click();
  const handle = bar.locator(`[data-edge="${side}"]`);
  await handle.waitFor();
  const [barBox, handleBox, playheadBox, time] = await Promise.all([
    bar.boundingBox(),
    handle.boundingBox(),
    playhead.boundingBox(),
    playhead.getAttribute("data-time"),
  ]);
  assert(barBox && handleBox && playheadBox, "Timeline geometry must be measurable");
  const boundary = side === "l" ? barBox.x : barBox.x + barBox.width;
  const movement = playheadBox.x + candidateOffset - boundary;
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + movement, startY, { steps: 12 });
  const [duringBar, duringPlayhead, duringTime] = await Promise.all([
    bar.boundingBox(),
    playhead.boundingBox(),
    playhead.getAttribute("data-time"),
  ]);
  assert(
    duringBar && duringPlayhead,
    "Timeline geometry must remain measurable during trimming",
  );
  await page.mouse.up();
  const [afterBar, afterPlayhead, afterTime] = await Promise.all([
    bar.boundingBox(),
    playhead.boundingBox(),
    playhead.getAttribute("data-time"),
  ]);
  assert(afterBar && afterPlayhead, "Timeline geometry must remain measurable after trimming");
  return {
    liveBoundary:
      side === "l" ? duringBar.x : duringBar.x + duringBar.width,
    livePlayheadX: duringPlayhead.x,
    liveTime: Number(duringTime),
    boundary: side === "l" ? afterBar.x : afterBar.x + afterBar.width,
    playheadX: afterPlayhead.x,
    playheadMoved: Math.abs(afterPlayhead.x - playheadBox.x),
    timeBefore: Number(time),
    timeAfter: Number(afterTime),
  };
}

async function expectMagneticTrim({ bar, kind, side, label }) {
  const before = await timingState();
  const originalEdge = edgeTime(before, kind, side);
  const result = await dragEdgeNearPlayhead(bar, side);
  const after = await timingState();
  assert(
    Math.abs(result.liveBoundary - result.livePlayheadX) < 1,
    `${label} did not click onto the playhead before release`,
  );
  assert(
    Math.abs(result.liveTime - result.timeBefore) < 0.000001,
    `${label} moved the playhead during the drag`,
  );
  assert(
    Math.abs(result.boundary - result.liveBoundary) < 0.25,
    `${label} changed when the pointer was released`,
  );
  assert(
    Math.abs(result.timeAfter - result.timeBefore) < 0.000001,
    `${label} moved the playhead time`,
  );
  assert(result.playheadMoved < 0.25, `${label} moved the rendered playhead`);
  assert(
    Math.abs(edgeTime(after, kind, side) - after.playhead) < 0.000001,
    `${label} did not store the exact playhead time`,
  );
  assert.equal(after.past, before.past + 1, `${label} should create one undo step`);

  await undo.click();
  const restored = await timingState();
  assert(
    Math.abs(edgeTime(restored, kind, side) - originalEdge) < 0.000001,
    `Undo did not restore ${label}`,
  );
}

async function expectDesktopMagnetRelease(bar) {
  await bar.click();
  const handle = bar.locator('[data-edge="r"]');
  const [barBox, handleBox, playheadBox] = await Promise.all([
    bar.boundingBox(),
    handle.boundingBox(),
    playhead.boundingBox(),
  ]);
  assert(
    barBox && handleBox && playheadBox,
    "Desktop release geometry must be measurable",
  );
  const boundary = barBox.x + barBox.width;
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + playheadBox.x + 5 - boundary, startY);
  const snappedBox = await bar.boundingBox();
  assert(snappedBox, "Desktop bar must remain visible in the magnetic zone");
  assert(
    Math.abs(snappedBox.x + snappedBox.width - playheadBox.x) < 1,
    "Desktop edge did not enter the magnet while the mouse was held",
  );
  await page.mouse.move(startX + playheadBox.x + 12 - boundary, startY);
  const releasedBox = await bar.boundingBox();
  assert(releasedBox, "Desktop bar must remain visible outside the magnetic zone");
  const releasedDistance = releasedBox.x + releasedBox.width - playheadBox.x;
  assert(
    releasedDistance > 11 && releasedDistance < 13,
    `Desktop edge stayed stuck outside the magnet (${releasedDistance.toFixed(2)}px)`,
  );
  const beforePointerUp = await timingState();
  await page.mouse.up();
  const afterPointerUp = await timingState();
  assert.equal(
    edgeTime(afterPointerUp, "component", "r"),
    edgeTime(beforePointerUp, "component", "r"),
    "Desktop pointer-up changed the freely dragged edge",
  );
  await undo.click();
}

async function expectDesktopVideoMagnetRelease(bar) {
  await bar.click();
  const handle = bar.locator('[data-edge="r"]');
  const [barBox, handleBox, playheadBox, playheadTime] = await Promise.all([
    bar.boundingBox(),
    handle.boundingBox(),
    playhead.boundingBox(),
    playhead.getAttribute("data-time"),
  ]);
  assert(
    barBox && handleBox && playheadBox,
    "Desktop video release geometry must be measurable",
  );
  const boundary = barBox.x + barBox.width;
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + playheadBox.x + 5 - boundary, startY, {
    steps: 12,
  });
  const snappedBox = await bar.boundingBox();
  assert(snappedBox, "Desktop video must remain visible in the magnetic zone");
  assert(
    Math.abs(snappedBox.x + snappedBox.width - playheadBox.x) < 1,
    "Desktop video edge did not enter the magnet while the mouse was held",
  );
  await page.mouse.move(startX + playheadBox.x - 12 - boundary, startY, {
    steps: 4,
  });
  const [releasedBox, stationaryPlayhead, stationaryTime] = await Promise.all([
    bar.boundingBox(),
    playhead.boundingBox(),
    playhead.getAttribute("data-time"),
  ]);
  assert(
    releasedBox && stationaryPlayhead,
    "Desktop video must remain measurable outside the magnetic zone",
  );
  const releasedDistance =
    stationaryPlayhead.x - (releasedBox.x + releasedBox.width);
  assert(
    releasedDistance > 11 && releasedDistance < 13,
    `Desktop video stayed stuck outside the magnet (${releasedDistance.toFixed(2)}px)`,
  );
  assert.equal(
    Number(stationaryTime),
    Number(playheadTime),
    "Desktop video trim moved the playhead while the mouse was held",
  );
  const beforePointerUp = await timingState();
  await page.mouse.up();
  const afterPointerUp = await timingState();
  assert.equal(
    edgeTime(afterPointerUp, "video", "r"),
    edgeTime(beforePointerUp, "video", "r"),
    "Desktop pointer-up changed the freely dragged video edge",
  );
  await undo.click();
}

async function expectLiveMobileTrim({
  bar,
  handle,
  select,
  prepare,
  kind,
  side,
  label,
  playhead: mobilePlayhead,
  undo: mobileUndo,
}) {
  await prepare?.();
  if (!(await handle.count())) await select.click();
  await handle.waitFor();
  const before = await timingState();
  const originalEdge = edgeTime(before, kind, side);
  const [barBox, handleBox, playheadBox] = await Promise.all([
    bar.boundingBox(),
    handle.boundingBox(),
    mobilePlayhead.boundingBox(),
  ]);
  assert(barBox && handleBox && playheadBox, "Mobile timeline geometry must be measurable");
  const playheadX = playheadBox.x + playheadBox.width / 2;
  const boundary = side === "l" ? barBox.x : barBox.x + barBox.width;
  const movement = playheadX + 5 - boundary;
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY }],
  });
  for (let step = 1; step <= 12; step += 1)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX + (movement * step) / 12, y: startY }],
    });

  const [during, duringBar, duringPlayhead] = await Promise.all([
    timingState(),
    bar.boundingBox(),
    mobilePlayhead.boundingBox(),
  ]);
  assert(duringBar && duringPlayhead, "Mobile geometry must remain measurable during trimming");
  const duringBoundary =
    side === "l" ? duringBar.x : duringBar.x + duringBar.width;
  const duringPlayheadX = duringPlayhead.x + duringPlayhead.width / 2;
  assert(
    Math.abs(duringBoundary - duringPlayheadX) < 1,
    `${label} did not click onto the playhead before release (${JSON.stringify({ before, during, duringBoundary, duringPlayheadX, movement })})`,
  );
  assert(
    Math.abs(edgeTime(during, kind, side) - during.playhead) < 0.000001,
    `${label} did not update its stored edge during the drag`,
  );
  assert.equal(during.playhead, before.playhead, `${label} moved the playhead time`);
  assert(
    Math.abs(duringPlayheadX - playheadX) < 0.25,
    `${label} moved the rendered playhead (${playheadX} to ${duringPlayheadX})`,
  );
  const duringHandle = await handle.boundingBox();
  assert(duringHandle, `${label} handle disappeared during the drag`);
  const ownsPointer = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        handle: !!target?.closest("[data-edge],[data-side],.handleL,.handleR"),
        playhead: target?.closest('[aria-label="Timeline playhead"]') != null,
      };
    },
    {
      x: duringHandle.x + duringHandle.width / 2,
      y: duringHandle.y + duringHandle.height / 2,
    },
  );
  assert(ownsPointer.handle && !ownsPointer.playhead, `${label} is blocked by the mobile playhead`);

  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const after = await timingState();
  assert(
    Math.abs(edgeTime(after, kind, side) - after.playhead) < 0.000001,
    `${label} changed when the pointer was released`,
  );
  await mobileUndo.click();
  const restored = await timingState();
  assert(
    Math.abs(edgeTime(restored, kind, side) - originalEdge) < 0.000001,
    `Undo did not restore ${label}`,
  );
}

async function expectMobileMagnetRelease({
  bar,
  handle,
  playhead: mobilePlayhead,
  undo: mobileUndo,
}) {
  const [barBox, handleBox, playheadBox] = await Promise.all([
    bar.boundingBox(),
    handle.boundingBox(),
    mobilePlayhead.boundingBox(),
  ]);
  assert(
    barBox && handleBox && playheadBox,
    "Mobile release geometry must be measurable",
  );
  const playheadX = playheadBox.x + playheadBox.width / 2;
  const boundary = barBox.x + barBox.width;
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: startX + playheadX + 5 - boundary, y: startY }],
  });
  const snappedBox = await bar.boundingBox();
  assert(snappedBox, "Mobile bar must remain visible in the magnetic zone");
  assert(
    Math.abs(snappedBox.x + snappedBox.width - playheadX) < 1,
    "Mobile edge did not enter the magnet while the finger was held",
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: startX + playheadX - 12 - boundary, y: startY }],
  });
  const releasedBox = await bar.boundingBox();
  assert(releasedBox, "Mobile bar must remain visible outside the magnetic zone");
  const releasedDistance = playheadX - (releasedBox.x + releasedBox.width);
  assert(
    releasedDistance > 11 && releasedDistance < 13,
    `Mobile edge stayed stuck outside the magnet (${releasedDistance.toFixed(2)}px)`,
  );
  const beforeTouchEnd = await timingState();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const afterTouchEnd = await timingState();
  assert.equal(
    edgeTime(afterTouchEnd, "component", "r"),
    edgeTime(beforeTouchEnd, "component", "r"),
    "Mobile touch-end changed the freely dragged edge",
  );
  await mobileUndo.click();
}

try {
  const editorUrl =
    process.env.EDITOR_URL ||
    "http://127.0.0.1:5173/";
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const { extractSelectedAudio } =
      await import("/src/state/editing/audioCommands.ts");
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
      t: 0.53,
      playing: false,
      past: [],
      future: [],
    });
    const componentId = useCapture.getState().addComponent("tooltip");
    useCapture
      .getState()
      .updateComponent(componentId, { at: 0, dur: 1.1 }, false);
    const textId = useCapture.getState().addText("Magnetic trim");
    useCapture
      .getState()
      .updateText(textId, { start: 0, end: 1.1 }, false);
    useCapture.getState().patch({ sel: 0, t: 0.53 });
    extractSelectedAudio();
    const extracted = useCapture.getState().audioClips[0];
    const audioId = extracted.id;
    useCapture.getState().updateScene(
      "main",
      { audioClips: [{ ...extracted, start: 0, out: 1.1 }] },
      false,
    );
    useCapture.getState().patch({
      t: 0.53,
      sel: -1,
      selComp: null,
      selText: null,
      selAudio: null,
      sheet: null,
      past: [],
      future: [],
    });
    window.timelineSnapCapture = useCapture;
    window.timelineSnapFixture = { componentId, textId, audioId };
  });
  await page.locator("[data-desktop-editor]").waitFor();
  await timeline.getByRole("slider", { name: "Timeline zoom" }).fill("16");

  const component = timeline.locator('button[data-kind="component"]');
  const text = timeline.locator('button[data-kind="text"]');
  const audio = timeline.locator("[data-audio-id]");
  const video = timeline.getByRole("button", { name: /^Clip 1,/ });
  for (const [bar, label] of [
    [component, "component"],
    [text, "text"],
    [audio, "audio"],
  ]) {
    const box = await bar.boundingBox();
    assert(box, `${label} geometry must be measurable`);
    assert(
      Math.abs(box.width - 17.6) < 0.2,
      `${label} must render at its real 1.1-second width, got ${box.width}px`,
    );
  }

  for (const check of [
    { bar: component, kind: "component", side: "l", label: "Component left edge" },
    { bar: component, kind: "component", side: "r", label: "Component right edge" },
    { bar: text, kind: "text", side: "l", label: "Text left edge" },
    { bar: text, kind: "text", side: "r", label: "Text right edge" },
    { bar: audio, kind: "audio", side: "l", label: "Extracted-audio left edge" },
    { bar: audio, kind: "audio", side: "r", label: "Extracted-audio right edge" },
    { bar: video, kind: "video", side: "r", label: "Video right edge" },
  ])
    await expectMagneticTrim(check);

  await expectDesktopMagnetRelease(component);
  await page.evaluate(() => window.timelineSnapCapture.getState().patch({ t: 3 }));
  await expectDesktopVideoMagnetRelease(video);
  await page.evaluate(() => window.timelineSnapCapture.getState().patch({ t: 0.53 }));

  const snap = timeline.getByRole("button", { name: "Snap to edges", exact: true });
  assert.equal(await snap.getAttribute("aria-pressed"), "true");
  await snap.click();
  assert.equal(await snap.getAttribute("aria-pressed"), "false");
  const beforeFreeTrim = await timingState();
  const freeTrim = await dragEdgeNearPlayhead(component, "r");
  const distance = Math.abs(freeTrim.boundary - freeTrim.playheadX);
  assert(
    distance > 4 && distance < 6,
    `Snap off should leave the component edge about 5px away, got ${distance.toFixed(2)}px`,
  );
  assert(
    Math.abs(freeTrim.timeAfter - freeTrim.timeBefore) < 0.000001,
    "Free trim moved the playhead time",
  );
  await undo.click();
  const afterFreeTrimUndo = await timingState();
  assert(
    Math.abs(
      edgeTime(afterFreeTrimUndo, "component", "r") -
        edgeTime(beforeFreeTrim, "component", "r"),
    ) < 0.000001,
    "Undo did not restore the non-snapped trim",
  );

  await page.setViewportSize({ width: 390, height: 850 });
  const mobileTimeline = page.locator(".tl");
  const mobilePlayhead = mobileTimeline.locator(".playhead");
  const mobileUndo = page.getByRole("button", { name: "Undo", exact: true });
  await mobileTimeline.getByRole("slider", { name: "Timeline playhead" }).waitFor();
  const mobileComponent = mobileTimeline.locator(".compBar");
  const mobileText = mobileTimeline.locator(".textBar");
  const mobileAudio = mobileTimeline.locator("[data-audio-id]");
  const mobileVideo = mobileTimeline.locator(".tlClip");
  const setMobilePlayhead = (time) => () =>
    page.evaluate(async (nextTime) => {
      const { useCapture } = await import("/src/store.ts");
      useCapture.getState().patch({ t: nextTime });
    }, time);
  for (const check of [
    {
      bar: mobileComponent,
      select: mobileTimeline.getByRole("button", {
        name: /Select component layer:/,
      }),
      handle: mobileComponent.locator('[data-side="l"]'),
      kind: "component",
      side: "l",
      label: "Mobile component left edge",
      prepare: setMobilePlayhead(0.12),
    },
    {
      bar: mobileComponent,
      select: mobileTimeline.getByRole("button", {
        name: /Select component layer:/,
      }),
      handle: mobileComponent.locator('[data-side="r"]'),
      kind: "component",
      side: "r",
      label: "Mobile component right edge",
      prepare: setMobilePlayhead(0.98),
    },
    {
      bar: mobileText,
      select: mobileTimeline.getByRole("button", {
        name: /Select text layer:/,
      }),
      handle: mobileText.locator('[data-side="l"]'),
      kind: "text",
      side: "l",
      label: "Mobile text left edge",
      prepare: setMobilePlayhead(0.12),
    },
    {
      bar: mobileText,
      select: mobileTimeline.getByRole("button", {
        name: /Select text layer:/,
      }),
      handle: mobileText.locator('[data-side="r"]'),
      kind: "text",
      side: "r",
      label: "Mobile text right edge",
      prepare: setMobilePlayhead(0.98),
    },
    {
      bar: mobileAudio,
      select: mobileTimeline.getByRole("button", { name: /Select Clip 1 audio/ }),
      handle: mobileAudio.locator('[data-edge="l"]'),
      kind: "audio",
      side: "l",
      label: "Mobile extracted-audio left edge",
      prepare: setMobilePlayhead(0.12),
    },
    {
      bar: mobileAudio,
      select: mobileTimeline.getByRole("button", { name: /Select Clip 1 audio/ }),
      handle: mobileAudio.locator('[data-edge="r"]'),
      kind: "audio",
      side: "r",
      label: "Mobile extracted-audio right edge",
      prepare: setMobilePlayhead(0.98),
    },
    {
      bar: mobileVideo,
      select: mobileTimeline.getByRole("button", {
        name: "Select video layer",
        exact: true,
      }),
      handle: mobileVideo.locator(".handleR"),
      kind: "video",
      side: "r",
      label: "Mobile video right edge",
      prepare: setMobilePlayhead(7.37),
    },
  ])
    await expectLiveMobileTrim({
      ...check,
      playhead: mobilePlayhead,
      undo: mobileUndo,
    });

  await setMobilePlayhead(0.98)();
  if (!(await mobileComponent.locator('[data-side="r"]').count()))
    await mobileTimeline
      .getByRole("button", { name: /Select component layer:/ })
      .click();
  await expectMobileMagnetRelease({
    bar: mobileComponent,
    handle: mobileComponent.locator('[data-side="r"]'),
    playhead: mobilePlayhead,
    undo: mobileUndo,
  });

  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop and mobile layer edges click onto the stationary playhead during the drag; short-bar geometry, Snap off and Undo retain their contracts.",
  );
} finally {
  await browser.close();
}
