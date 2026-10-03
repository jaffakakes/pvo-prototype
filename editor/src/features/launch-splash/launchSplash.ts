import {
  LAUNCH_SPLASH_REDUCED_REVEAL_MS,
  LAUNCH_SPLASH_REVEAL_MS,
  nextLaunchSplashBeatBoundary,
} from "./launchSplashTimeline";

const SPLASH_ID = "restyle-launch-splash";
const ROOT_PENDING_CLASS = "launchSplashPending";
const ROOT_REVEAL_CLASS = "launchSplashRevealing";
const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MAX_REVEAL_WAIT_MS = 8000;

let dismissal: Promise<void> | null = null;
let resolveDismissal: (() => void) | null = null;
let blockingKeys = false;

function splashElement(): HTMLElement | null {
  return document.getElementById(SPLASH_ID);
}

function appRoot(): HTMLElement | null {
  return document.getElementById("root");
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  let timer: number | undefined;
  try {
    await untilAborted(new Promise<void>(resolve => {
      timer = window.setTimeout(resolve, milliseconds);
    }), signal);
  } finally {
    window.clearTimeout(timer);
  }
}

function dismissalPromise(): Promise<void> {
  if (!splashElement()) return Promise.resolve();
  if (!dismissal) {
    dismissal = new Promise(resolve => {
      resolveDismissal = resolve;
    });
  }
  return dismissal;
}

function reducedMotionRequested(appPreference: boolean): boolean {
  return appPreference || window.matchMedia(REDUCE_MOTION_QUERY).matches;
}

function setMotionPreference(appPreference: boolean): void {
  const splash = splashElement();
  if (splash) splash.dataset.reduceMotion = String(appPreference);
}

function blockKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function setKeyboardBlock(blocked: boolean): void {
  if (blockingKeys === blocked) return;
  blockingKeys = blocked;
  if (blocked) window.addEventListener("keydown", blockKey, true);
  else window.removeEventListener("keydown", blockKey, true);
}

function animationElapsed(splash: HTMLElement): number {
  const bob = splash.querySelector<HTMLElement>(".launchSplashBob");
  const animation = bob?.getAnimations().find(candidate =>
    (candidate as CSSAnimation).animationName === "launchSplashBob",
  );
  const currentTime = Number(animation?.currentTime);
  return Number.isFinite(currentTime) ? currentTime : performance.now();
}

async function waitForImages(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img"), image => image.decode().catch(() => {})),
  );
}

async function waitForRootContent(root: HTMLElement, signal: AbortSignal): Promise<void> {
  if (root.firstElementChild) return;
  let observer: MutationObserver | undefined;
  try {
    await untilAborted(new Promise<void>(resolve => {
      observer = new MutationObserver(() => {
        if (root.firstElementChild) resolve();
      });
      observer.observe(root, { childList: true });
    }), signal);
  } finally {
    observer?.disconnect();
  }
}

async function waitForPaint(signal: AbortSignal): Promise<void> {
  for (let frame = 0; frame < 2; frame++) {
    let pending: number | undefined;
    try {
      await untilAborted(new Promise<void>(resolve => {
        pending = requestAnimationFrame(() => resolve());
      }), signal);
    } finally {
      if (pending !== undefined) cancelAnimationFrame(pending);
    }
  }
}

async function waitForFirstScreen(signal: AbortSignal): Promise<void> {
  const root = appRoot();
  if (!root) return;
  await waitForRootContent(root, signal);
  await waitForPaint(signal);
  await untilAborted(Promise.all([document.fonts.ready, waitForImages(root)]), signal);
  await waitForPaint(signal);
}

function updateRevealGeometry(splash: HTMLElement, root: HTMLElement): void {
  const mark = splash.querySelector<HTMLElement>(".launchSplashMarkIntro");
  if (!mark) return;
  const width = mark.offsetWidth;
  const eyeX = mark.offsetLeft + width * 0.4012;
  const eyeY = mark.offsetTop + width * 0.5076;
  const radiusX = width * 0.1064;
  const radiusY = width * 0.12615;
  const viewportWidth = root.clientWidth;
  const viewportHeight = root.clientHeight;
  const minimumScale = width >= 200 ? 64 : 48;
  const coveringScale = Math.ceil(
    (0.75 * Math.hypot(viewportWidth, viewportHeight)) / radiusX,
  );
  const scale = Math.max(minimumScale, coveringScale);
  const shiftX = viewportWidth / 2 - eyeX;
  const shiftY = viewportHeight / 2 - eyeY;

  splash.style.setProperty("--launch-eye-x", `${eyeX}px`);
  splash.style.setProperty("--launch-eye-y", `${eyeY}px`);
  splash.style.setProperty("--launch-shift-x", `${shiftX}px`);
  splash.style.setProperty("--launch-shift-y", `${shiftY}px`);
  splash.style.setProperty("--launch-scale", String(scale));
  root.style.setProperty("--launch-clip-x", `${eyeX}px`);
  root.style.setProperty("--launch-clip-y", `${eyeY}px`);
  root.style.setProperty("--launch-clip-radius-x", `${radiusX}px`);
  root.style.setProperty("--launch-clip-radius-y", `${radiusY}px`);
  root.style.setProperty("--launch-clip-end-x", `${radiusX * scale}px`);
  root.style.setProperty("--launch-clip-end-y", `${radiusY * scale}px`);
  root.style.setProperty("--launch-clip-centre-x", `${viewportWidth / 2}px`);
  root.style.setProperty("--launch-clip-centre-y", `${viewportHeight / 2}px`);
}

function finishSplash(splash: HTMLElement, root: HTMLElement | null): void {
  root?.classList.remove(ROOT_PENDING_CLASS);
  root?.classList.remove(ROOT_REVEAL_CLASS);
  root?.removeAttribute("inert");
  root?.removeAttribute("aria-busy");
  setKeyboardBlock(false);
  splash.remove();
  resolveDismissal?.();
  resolveDismissal = null;
}

async function revealWithReducedMotion(
  splash: HTMLElement,
  signal: AbortSignal,
): Promise<void> {
  splash.dataset.reduceMotion = "true";
  const fade = splash.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    {
      duration: LAUNCH_SPLASH_REDUCED_REVEAL_MS,
      easing: "linear",
      fill: "forwards",
    },
  );
  try {
    await untilAborted(fade.finished, signal);
  } finally {
    fade.cancel();
  }
}

async function revealWithBlink(
  splash: HTMLElement,
  root: HTMLElement,
  signal: AbortSignal,
): Promise<void> {
  const resize = () => updateRevealGeometry(splash, root);
  resize();
  window.addEventListener("resize", resize);
  splash.classList.add("is-revealing");
  root.classList.add(ROOT_REVEAL_CLASS);
  try {
    await wait(LAUNCH_SPLASH_REVEAL_MS, signal);
  } finally {
    window.removeEventListener("resize", resize);
  }
}

/** Keep camera and app input gated until the cold-start overlay has been removed. */
export function whenLaunchSplashDismissed(): Promise<void> {
  return dismissalPromise();
}

/** Apply the stored preference before the recovered first screen is mounted. */
export function prepareLaunchSplash(appReduceMotion: boolean): void {
  const root = appRoot();
  const splash = splashElement();
  if (!splash) {
    root?.classList.remove(ROOT_PENDING_CLASS);
    root?.removeAttribute("inert");
    root?.removeAttribute("aria-busy");
    setKeyboardBlock(false);
    return;
  }
  root?.setAttribute("inert", "");
  root?.setAttribute("aria-busy", "true");
  setKeyboardBlock(true);
  setMotionPreference(appReduceMotion);
  void dismissalPromise();
}

/** Reveal the real rendered first screen, then release input and camera access. */
export async function revealLaunchSplashWhenReady(
  appReduceMotion: boolean,
): Promise<void> {
  const splash = splashElement();
  const root = appRoot();
  if (!splash) {
    root?.classList.remove(ROOT_PENDING_CLASS);
    root?.removeAttribute("inert");
    root?.removeAttribute("aria-busy");
    return;
  }

  // Asset decoding and animation promises can remain pending in a suspended tab.
  // A decorative transition must not indefinitely hide the recovered editor.
  const controller = new AbortController();
  const deadline = window.setTimeout(() => {
    controller.abort(new Error("Launch splash readiness timed out."));
  }, MAX_REVEAL_WAIT_MS);
  try {
    await waitForFirstScreen(controller.signal);
    if (reducedMotionRequested(appReduceMotion)) {
      await revealWithReducedMotion(splash, controller.signal);
      return;
    }

    const elapsed = animationElapsed(splash);
    await wait(Math.max(0, nextLaunchSplashBeatBoundary(elapsed) - elapsed), controller.signal);
    if (reducedMotionRequested(appReduceMotion)) {
      await revealWithReducedMotion(splash, controller.signal);
      return;
    }
    if (root) await revealWithBlink(splash, root, controller.signal);
  } catch (error) {
    console.warn("Restyle launch reveal did not finish; releasing the editor:", error);
  } finally {
    window.clearTimeout(deadline);
    controller.abort();
    finishSplash(splash, root);
  }
}
