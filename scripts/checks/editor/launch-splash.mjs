import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});

async function instrumentCamera(page) {
  await page.addInitScript(() => {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__launchCameraRequests = 0;
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.__launchCameraRequests += 1;
      return nativeGetUserMedia(...args);
    };
  });
}

async function initialSplashState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#root");
    const splash = document.querySelector("#restyle-launch-splash");
    const mark = document.querySelector(".launchSplashMarkIntro");
    const word = document.querySelector(".launchSplashWord");
    return {
      splash: !!splash,
      ariaHidden: splash?.getAttribute("aria-hidden"),
      pointerEvents: splash ? getComputedStyle(splash).pointerEvents : null,
      busy: root?.getAttribute("aria-busy"),
      inert: root?.hasAttribute("inert"),
      pendingClass: root?.classList.contains("launchSplashPending"),
      mark: mark && {
        width: mark.offsetWidth,
        left: mark.offsetLeft,
        top: mark.offsetTop,
      },
      wordSize: word ? getComputedStyle(word).fontSize : null,
      cameraRequests: window.__launchCameraRequests,
      cameraVisible: !!document.querySelector(".camWrap"),
      landingVisible: document.querySelector("#create-title")?.textContent,
    };
  });
}

async function runFullMotion({ width, height, mobile }) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  await instrumentCamera(page);
  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    const initial = await initialSplashState(page);
    assert.equal(initial.splash, true);
    assert.equal(initial.ariaHidden, "true");
    assert.equal(initial.pointerEvents, "auto");
    assert.equal(initial.busy, "true");
    assert.equal(initial.inert, true);
    assert.equal(initial.pendingClass, true);
    assert.equal(initial.cameraRequests, 0);
    assert.equal(Math.round(initial.mark.width), mobile ? 150 : 200);
    assert.equal(initial.wordSize, mobile ? "40px" : "50px");
    assert(Math.abs(initial.mark.left - (width - initial.mark.width) / 2) < 1);
    const expectedTop = (height - (initial.mark.width * 0.99 + (mobile ? 24 : 26) + (mobile ? 40 : 50))) / 2;
    assert(Math.abs(initial.mark.top - expectedTop) < 2);
    await page.locator(mobile ? ".camWrap" : "#create-title").waitFor({ state: "attached" });
    const mounted = await initialSplashState(page);
    assert.equal(mounted.splash, true);
    assert.equal(mounted.cameraRequests, 0);
    assert.equal(mounted.cameraVisible, mobile);
    assert.equal(mounted.landingVisible, mobile ? undefined : "Start a new edit");
    if (mobile) {
      const fallback = page.locator('[data-launch-splash-hidden="true"]').first().locator("..");
      assert.match(await fallback.evaluate(element => getComputedStyle(element).backgroundImage), /gradient/i);
      assert.deepEqual(
        await page.locator('[data-launch-splash-hidden="true"]').evaluateAll(elements =>
          elements.map(element => getComputedStyle(element).opacity),
        ),
        ["0", "0", "0"],
      );
    }

    const blocked = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
      return !window.dispatchEvent(event);
    });
    assert.equal(blocked, true, "splash should consume app keyboard input");

    await page.waitForFunction(() => document.querySelector("#restyle-launch-splash")?.classList.contains("is-revealing"));
    const reveal = await page.evaluate(() => {
      const root = document.querySelector("#root");
      const splash = document.querySelector("#restyle-launch-splash");
      return {
        cameraRequests: window.__launchCameraRequests,
        rootAnimations: root?.getAnimations().map(animation => animation.animationName),
        splashAnimations: splash?.getAnimations({ subtree: true }).map(animation => animation.animationName),
        eyeX: Number.parseFloat(splash?.style.getPropertyValue("--launch-eye-x") || ""),
        eyeY: Number.parseFloat(splash?.style.getPropertyValue("--launch-eye-y") || ""),
        scale: Number.parseFloat(splash?.style.getPropertyValue("--launch-scale") || ""),
      };
    });
    assert.equal(reveal.cameraRequests, 0, "camera permission must remain gated through the reveal");
    assert(reveal.rootAnimations?.includes("launchSplashAppClip"));
    assert(reveal.splashAnimations?.includes("launchSplashZoom"));
    assert(Number.isFinite(reveal.eyeX) && Number.isFinite(reveal.eyeY));
    assert(reveal.scale >= (mobile ? 48 : 64));

    await page.waitForFunction(() => !document.querySelector("#restyle-launch-splash"));
    const complete = await page.evaluate(() => ({
      elapsed: performance.now(),
      busy: document.querySelector("#root")?.hasAttribute("aria-busy"),
      inert: document.querySelector("#root")?.hasAttribute("inert"),
      revealClass: document.querySelector("#root")?.classList.contains("launchSplashRevealing"),
      pendingClass: document.querySelector("#root")?.classList.contains("launchSplashPending"),
      cameraRequests: window.__launchCameraRequests,
    }));
    assert(complete.elapsed >= 3400, `full splash ended too early at ${complete.elapsed}ms`);
    assert.equal(complete.busy, false);
    assert.equal(complete.inert, false);
    assert.equal(complete.revealClass, false);
    assert.equal(complete.pendingClass, false);
    if (mobile) {
      await page.waitForFunction(() => window.__launchCameraRequests === 1);
    } else {
      assert.equal(complete.cameraRequests, 0);
    }
  } finally {
    await context.close();
  }
}

async function runReducedMotion(appPreference) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    reducedMotion: appPreference ? "no-preference" : "reduce",
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  if (appPreference) {
    await page.addInitScript(() => {
      localStorage.setItem("restyle.editor.reduceMotion", "true");
    });
  }
  await instrumentCamera(page);
  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    const staticState = await page.evaluate(() => ({
      markAnimation: getComputedStyle(document.querySelector(".launchSplashMarkIntro")).animationName,
      bobAnimation: getComputedStyle(document.querySelector(".launchSplashBob")).animationName,
      lidTransform: getComputedStyle(document.querySelector(".launchSplashLidLeft")).transform,
      cameraRequests: window.__launchCameraRequests,
      storedPreference: document.documentElement.dataset.reduceMotion,
    }));
    assert.equal(staticState.markAnimation, "none");
    assert.equal(staticState.bobAnimation, "none");
    assert.equal(staticState.lidTransform, "matrix(1, 0, 0, 0, 0, 0)");
    assert.equal(staticState.cameraRequests, 0);
    assert.equal(staticState.storedPreference, appPreference ? "true" : undefined);
    await page.waitForFunction(() => !document.querySelector("#restyle-launch-splash"));
    const complete = await page.evaluate(() => ({
      elapsed: performance.now(),
      clipAnimations: document.querySelector("#root")?.getAnimations().length,
    }));
    assert(complete.elapsed < 2500, `reduced splash waited for a full beat (${complete.elapsed}ms)`);
    assert.equal(complete.clipAnimations, 0);
    await page.waitForFunction(() => window.__launchCameraRequests === 1);
  } finally {
    await context.close();
  }
}

async function runStalledReveal(stage) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(stage => {
    window.__launchStallObserved = false;
    window.__launchLate = [];
    if (stage === "fonts") {
      const pending = new Promise(resolve => window.__launchLate.push(resolve));
      Object.defineProperty(document.fonts, "ready", { get() {
        window.__launchStallObserved = true;
        return pending;
      } });
    } else if (stage === "images") {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        if (!this.closest("#root")) return decode.call(this);
        window.__launchStallObserved = true;
        return new Promise(resolve => window.__launchLate.push(resolve));
      };
    } else if (stage === "paint") {
      let nextId = 1;
      window.__launchPendingFrames = new Map();
      window.requestAnimationFrame = callback => {
        window.__launchStallObserved = true;
        const id = nextId++;
        window.__launchPendingFrames.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = id => window.__launchPendingFrames.delete(id);
    } else if (stage === "animation") {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.id === "restyle-launch-splash") {
          window.__launchStallObserved = true;
          animation.pause();
          window.__launchPausedAnimation = animation;
        }
        return animation;
      };
    }
  }, stage);
  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#create-title").waitFor({ state: "attached" });
    await page.waitForFunction(() => window.__launchStallObserved, null, { polling: 100 });
    assert.equal(await page.locator("#root").getAttribute("inert"), "");
    await page.waitForFunction(() => !document.querySelector("#restyle-launch-splash"), null, { polling: 100 });
    const released = await page.evaluate(() => {
      const root = document.querySelector("#root");
      const key = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
      return { busy: root.hasAttribute("aria-busy"), inert: root.hasAttribute("inert"),
        pending: root.classList.contains("launchSplashPending"), revealing: root.classList.contains("launchSplashRevealing"),
        keysReleased: window.dispatchEvent(key), remainingFrames: window.__launchPendingFrames?.size,
        animationState: window.__launchPausedAnimation?.playState };
    });
    assert.deepEqual([released.busy, released.inert, released.pending, released.revealing], [false, false, false, false], `${stage}: timeout must release the real mounted editor`);
    assert.equal(released.keysReleased, true);
    if (stage === "paint") assert.equal(released.remainingFrames, 0, "Timed-out paint callbacks are cancelled");
    if (stage === "animation") assert.equal(released.animationState, "idle", "Timed-out fade animation is cancelled");
    await page.evaluate(async () => {
      window.__launchLate.forEach(resolve => resolve());
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(await page.locator("#restyle-launch-splash").count(), 0, "Late asset readiness cannot restart the reveal");
    assert.equal(await page.locator("#root").getAttribute("inert"), null);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

try {
  await runFullMotion({ width: 430, height: 932, mobile: true });
  await runFullMotion({ width: 1440, height: 900, mobile: false });
  await runReducedMotion(false);
  await runReducedMotion(true);
  await Promise.all(["fonts", "images", "paint", "animation"].map(runStalledReveal));
  console.log("Launch splash passed: responsive reveal, input/camera gate, reduced motion, bounded stalled assets/paint/animation and late-completion cleanup.");
} finally {
  await browser.close();
}
