import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream"],
});

async function instrumentCamera(page, { delayFirstMs = 0, holdRequests = [], failFrom = 0, failRequests = [] } = {}) {
  await page.addInitScript(({ delayFirstMs, holdRequests, failFrom, failRequests }) => {
    const devices = navigator.mediaDevices;
    const nativeGetUserMedia = devices.getUserMedia.bind(devices);
    window.__cameraRequests = [];
    window.__cameraReleases = {};
    devices.getUserMedia = async (constraints) => {
      const request = { constraints, stream: null };
      window.__cameraRequests.push(request);
      const requestNumber = window.__cameraRequests.length;
      if ((failFrom && requestNumber >= failFrom) || failRequests.includes(requestNumber)) {
        throw new DOMException("Camera unavailable", "NotAllowedError");
      }
      const stream = await nativeGetUserMedia(constraints);
      request.stream = stream;
      if (holdRequests.includes(requestNumber)) {
        await new Promise(resolve => { window.__cameraReleases[requestNumber] = resolve; });
      }
      if (requestNumber === 1 && delayFirstMs) {
        await new Promise(resolve => setTimeout(resolve, delayFirstMs));
      }
      return stream;
    };
  }, { delayFirstMs, holdRequests, failFrom, failRequests });
}

async function assertPendingCamera(page, message) {
  await page.getByText(message, { exact: true }).waitFor();
  if (await page.getByRole("heading", { name: "Camera is off" }).count()) {
    throw new Error(`${message} was shown with the permission-denied heading`);
  }
  if (await page.getByRole("button", { name: "Allow camera" }).count()) {
    throw new Error(`${message} was shown with the permission-retry button`);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  await instrumentCamera(page);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".live").waitFor();
  await page.waitForFunction(() => (document.querySelector(".live")?.videoWidth ?? 0) > 0);
  const startup = await page.evaluate(() => {
    const video = document.querySelector(".live");
    return {
      calls: window.__cameraRequests.length,
      attached: video.srcObject === window.__cameraRequests[0]?.stream,
      playing: !video.paused,
      autoplay: video.autoplay,
      controls: video.controls,
      pointerEvents: getComputedStyle(video).pointerEvents,
    };
  });
  if (startup.calls !== 1 || !startup.attached || !startup.playing) {
    throw new Error(`Camera should attach and play from one acquisition: ${JSON.stringify(startup)}`);
  }
  if (startup.autoplay || startup.controls || startup.pointerEvents !== "none") {
    throw new Error(`Live preview exposes browser media controls: ${JSON.stringify(startup)}`);
  }
  await page.getByRole("button", { name: "Flip camera" }).click();
  await page.waitForFunction(() => window.__cameraRequests.length === 2 &&
    document.querySelector(".live")?.srcObject?.getVideoTracks()[0] === window.__cameraRequests[1].stream?.getVideoTracks()[0] &&
    document.querySelector(".live")?.videoWidth > 0);
  const flipped = await page.evaluate(() => ({
    oldVideoEnded: window.__cameraRequests[0].stream.getVideoTracks().every(track => track.readyState === "ended"),
    audioReused: document.querySelector(".live").srcObject.getAudioTracks()[0] === window.__cameraRequests[0].stream.getAudioTracks()[0],
    audioLive: window.__cameraRequests[0].stream.getAudioTracks().every(track => track.readyState === "live"),
    videoOnlyRequest: window.__cameraRequests[1].constraints.audio === false,
    newLive: window.__cameraRequests[1].stream.getVideoTracks().every(track => track.readyState === "live"),
    playing: !document.querySelector(".live").paused,
  }));
  if (Object.values(flipped).some(value => !value)) throw new Error(`Flip did not reuse audio and play the new camera: ${JSON.stringify(flipped)}`);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.locator(".dockThumb video").waitFor();
  const recorded = await page.locator(".dockThumb video").evaluate(video => video.src.startsWith("blob:"));
  if (!recorded) throw new Error("The camera preview played but the take did not become a recorded video");
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.waitForFunction(() => window.__cameraRequests[0].stream.getAudioTracks().every(track => track.readyState === "ended") &&
    window.__cameraRequests[1].stream.getVideoTracks().every(track => track.readyState === "ended"));
  await context.close();

  const raceContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const race = await raceContext.newPage();
  await instrumentCamera(race, { delayFirstMs: 500 });
  await race.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await race.waitForFunction(() => window.__cameraRequests?.length === 1);
  await assertPendingCamera(race, "Starting camera…");
  if (await race.evaluate(() => window.__cameraRequests.length) !== 1) {
    throw new Error("Camera startup started duplicate permission requests");
  }
  const startupFlipDisabled = await race.getByRole("button", { name: "Flip camera" }).isDisabled();
  if (!startupFlipDisabled) throw new Error("Flip camera should wait for the first camera to become ready");
  await race.getByRole("button", { name: "Flip camera" }).evaluate(button => button.click());
  if (await race.evaluate(() => window.__cameraRequests.length) !== 1) {
    throw new Error("A flip during startup started an overlapping camera request");
  }
  await race.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  await race.getByRole("button", { name: "Flip camera" }).click();
  await race.waitForFunction(() => window.__cameraRequests.length === 2 &&
    document.querySelector(".live")?.srcObject?.getVideoTracks()[0] === window.__cameraRequests[1].stream?.getVideoTracks()[0] &&
    document.querySelector(".live")?.videoWidth > 0);
  await race.waitForTimeout(600);
  const settled = await race.evaluate(() => ({
    calls: window.__cameraRequests.length,
    firstVideoEnded: window.__cameraRequests[0].stream.getVideoTracks().every(track => track.readyState === "ended"),
    secondAttached: document.querySelector(".live")?.srcObject?.getVideoTracks()[0] === window.__cameraRequests[1].stream?.getVideoTracks()[0],
    secondLive: window.__cameraRequests[1].stream.getVideoTracks().every(track => track.readyState === "live"),
  }));
  if (settled.calls !== 2 || !settled.firstVideoEnded || !settled.secondAttached || !settled.secondLive) {
    throw new Error(`Camera startup or flip left the wrong video track attached: ${JSON.stringify(settled)}`);
  }
  await raceContext.close();

  const pendingContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const pending = await pendingContext.newPage();
  await instrumentCamera(pending, { holdRequests: [1, 2] });
  await pending.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await pending.waitForFunction(() => Boolean(window.__cameraReleases?.[1]));
  await assertPendingCamera(pending, "Starting camera…");
  await pending.evaluate(() => window.__cameraReleases[1]());
  await pending.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  await pending.getByRole("button", { name: "Flip camera" }).click();
  await pending.waitForFunction(() => Boolean(window.__cameraReleases?.[2]));
  await pending.waitForFunction(() => document.querySelector(".flipFreeze")?.dataset.visible === "true");
  const pendingFlip = await pending.evaluate(() => {
    const video = document.querySelector(".live");
    const canvas = document.querySelector(".flipFreeze");
    const button = document.querySelector('button[aria-label="Flip camera"]');
    const icon = button?.querySelector("svg");
    const animation = icon ? getComputedStyle(icon) : null;
    const angles = icon?.getAnimations()[0]?.effect?.getKeyframes().map(frame =>
      Number(String(frame.transform ?? "").match(/rotate\((-?[\d.]+)deg\)/)?.[1])) ?? [];
    return {
      liveCount: document.querySelectorAll(".live").length,
      frozenWidth: canvas?.width,
      frozenHeight: canvas?.height,
      frozenPixelAlpha: canvas?.getContext("2d")?.getImageData(0, 0, 1, 1).data[3],
      frozenVisible: canvas && getComputedStyle(canvas).display !== "none" && getComputedStyle(canvas).visibility !== "hidden",
      frameCoversVideo: canvas && video &&
        Math.abs(canvas.getBoundingClientRect().width - video.getBoundingClientRect().width) < 2 &&
        Math.abs(canvas.getBoundingClientRect().height - video.getBoundingClientRect().height) < 2,
      frameOverVideo: canvas && video &&
        Number(getComputedStyle(canvas).zIndex) > (Number(getComputedStyle(video).zIndex) || 0),
      switching: button?.dataset.switching,
      disabled: button?.disabled,
      animation: animation?.animationName,
      duration: animation?.animationDuration,
      rocksBothWays: angles.some(angle => angle > 0) && angles.some(angle => angle < 0),
    };
  });
  if (pendingFlip.liveCount !== 1 || !pendingFlip.frozenWidth || !pendingFlip.frozenHeight ||
    !pendingFlip.frozenPixelAlpha || !pendingFlip.frozenVisible || !pendingFlip.frameCoversVideo ||
    !pendingFlip.frameOverVideo ||
    pendingFlip.switching !== "true" || !pendingFlip.disabled ||
    !pendingFlip.animation || pendingFlip.animation === "none" || pendingFlip.duration === "0s" || !pendingFlip.rocksBothWays) {
    throw new Error(`Camera flip did not preserve the last frame and animate the icon: ${JSON.stringify(pendingFlip)}`);
  }
  if (await pending.getByText("Switching camera…", { exact: true }).count()) {
    throw new Error("Camera flip replaced the frozen preview with a switching message");
  }
  if (await pending.getByRole("heading", { name: "Camera is off" }).count()) {
    throw new Error("Camera flip displayed the unavailable-camera fallback while pending");
  }
  await pending.emulateMedia({ reducedMotion: "reduce" });
  const reducedAnimation = await pending.getByRole("button", { name: "Flip camera" }).locator("svg").evaluate(icon => getComputedStyle(icon).animationName);
  if (reducedAnimation !== "none") throw new Error(`Flip icon animated despite reduced motion: ${reducedAnimation}`);
  await pending.emulateMedia({ reducedMotion: "no-preference" });
  await pending.evaluate(() => window.__cameraReleases[2]());
  await pending.waitForFunction(() => document.querySelector(".live")?.srcObject?.getVideoTracks()[0] === window.__cameraRequests[1]?.stream?.getVideoTracks()[0] &&
    document.querySelector(".live")?.videoWidth > 0);
  await pending.waitForFunction(() => document.querySelector('button[aria-label="Flip camera"]')?.dataset.switching !== "true");
  const readyFlip = await pending.evaluate(() => {
    const button = document.querySelector('button[aria-label="Flip camera"]');
    return {
      frozenVisible: document.querySelector(".flipFreeze")?.dataset.visible,
      disabled: button?.disabled,
      animation: button?.querySelector("svg") ? getComputedStyle(button.querySelector("svg")).animationName : null,
    };
  });
  if (readyFlip.frozenVisible === "true" || readyFlip.disabled || readyFlip.animation !== "none") {
    throw new Error(`Flip transition remained after the new camera became ready: ${JSON.stringify(readyFlip)}`);
  }
  await pendingContext.close();

  const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const denied = await deniedContext.newPage();
  await instrumentCamera(denied, { failFrom: 2 });
  await denied.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await denied.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  await denied.getByRole("button", { name: "Flip camera" }).click();
  await denied.getByRole("heading", { name: "Camera is off" }).waitFor();
  await denied.getByRole("button", { name: "Allow camera" }).waitFor();
  const deniedSwitches = await denied.evaluate(() => window.__cameraRequests.slice(1).map(request => request.constraints));
  if (!deniedSwitches.length || deniedSwitches.length > 2 || deniedSwitches.some(constraints => constraints.audio !== false)) {
    throw new Error(`A video-only camera switch unexpectedly retried the microphone: ${JSON.stringify(deniedSwitches)}`);
  }
  await deniedContext.close();

  const silentContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const silent = await silentContext.newPage();
  // Deny both preferred and minimal video requests with audio so this fixture
  // actually reaches the video-only acquisition path.
  await instrumentCamera(silent, { failRequests: [1, 2] });
  await silent.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await silent.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  await silent.getByRole("button", { name: "Flip camera" }).click();
  await silent.waitForFunction(() => window.__cameraRequests.length === 4 &&
    document.querySelector(".live")?.srcObject?.getVideoTracks()[0] === window.__cameraRequests[3]?.stream?.getVideoTracks()[0] &&
    document.querySelector(".live")?.videoWidth > 0);
  const silentState = await silent.evaluate(() => ({
    calls: window.__cameraRequests.length,
    initialRetryVideoOnly: window.__cameraRequests[2].constraints.audio === false,
    flipVideoOnly: window.__cameraRequests[3].constraints.audio === false,
    noAudio: document.querySelector(".live").srcObject.getAudioTracks().length === 0,
  }));
  if (silentState.calls !== 4 || !silentState.initialRetryVideoOnly || !silentState.flipVideoOnly || !silentState.noAudio) {
    throw new Error(`Camera without microphone did not remain usable after flip: ${JSON.stringify(silentState)}`);
  }
  await silentContext.close();

  const endedAudioContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const endedAudio = await endedAudioContext.newPage();
  await instrumentCamera(endedAudio);
  await endedAudio.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await endedAudio.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  await endedAudio.evaluate(() => window.__cameraRequests[0].stream.getAudioTracks()[0].stop());
  await endedAudio.getByRole("button", { name: "Flip camera" }).click();
  await endedAudio.waitForFunction(() => window.__cameraRequests.length === 3 &&
    document.querySelector(".live")?.srcObject?.getAudioTracks()[0] === window.__cameraRequests[2]?.stream?.getAudioTracks()[0] &&
    document.querySelector(".live")?.videoWidth > 0);
  const recoveredAudio = await endedAudio.evaluate(() => ({
    videoOnlyFlip: window.__cameraRequests[1].constraints.audio === false,
    microphoneRetry: window.__cameraRequests[2].constraints.video === false && window.__cameraRequests[2].constraints.audio === true,
    audioLive: document.querySelector(".live").srcObject.getAudioTracks()[0].readyState === "live",
  }));
  if (!recoveredAudio.videoOnlyFlip || !recoveredAudio.microphoneRetry || !recoveredAudio.audioLive) {
    throw new Error(`An ended microphone track was not safely reacquired: ${JSON.stringify(recoveredAudio)}`);
  }
  await endedAudioContext.close();

  const rapidContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const rapid = await rapidContext.newPage();
  await instrumentCamera(rapid, { holdRequests: [2] });
  await rapid.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await rapid.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  await rapid.getByRole("button", { name: "Flip camera" }).click();
  await rapid.waitForFunction(() => Boolean(window.__cameraReleases?.[2]));
  await rapid.getByRole("button", { name: "Flip camera" }).evaluate(button => button.click());
  await rapid.waitForTimeout(100);
  const pendingCalls = await rapid.evaluate(() => window.__cameraRequests.length);
  if (pendingCalls !== 2) throw new Error(`A repeated flip started another camera request while switching: ${pendingCalls}`);
  await rapid.evaluate(() => window.__cameraReleases[2]());
  await rapid.waitForFunction(() => document.querySelector(".live")?.srcObject?.getVideoTracks()[0] === window.__cameraRequests[1]?.stream?.getVideoTracks()[0] &&
    document.querySelector(".live")?.videoWidth > 0);
  const rapidState = await rapid.evaluate(() => ({
    calls: window.__cameraRequests.length,
    audioReused: document.querySelector(".live").srcObject.getAudioTracks()[0] === window.__cameraRequests[0].stream.getAudioTracks()[0],
    latestLive: window.__cameraRequests[1].stream.getVideoTracks()[0].readyState === "live",
  }));
  if (rapidState.calls !== 2 || !rapidState.audioReused || !rapidState.latestLive) {
    throw new Error(`A repeated flip interrupted the requested camera or lost the microphone: ${JSON.stringify(rapidState)}`);
  }
  await rapidContext.close();
  console.log("Camera startup, audio reuse, frozen flip transition, reduced motion, playback, recording, cleanup, and late-request races passed");
} finally {
  await browser.close();
}
