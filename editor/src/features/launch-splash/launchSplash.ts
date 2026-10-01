import {
  LAUNCH_SPLASH_REDUCED_REVEAL_MS,
  LAUNCH_SPLASH_REVEAL_MS,
  nextLaunchSplashBeatBoundary,
} from "./launchSplashTimeline";

const SPLASH_ID = "restyle-launch-splash";
const ROOT_PENDING_CLASS = "launchSplashPending";
const ROOT_REVEAL_CLASS = "launchSplashRevealing";
const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let dismissal: Promise<void> | null = null;
let resolveDismissal: (() => void) | null = null;
let blockingKeys = false;

function splashElement(): HTMLElement | null {
  return document.getElementById(SPLASH_ID);
}

function appRoot(): HTMLElement | null {
  return document.getElementById("root");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
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

async function waitForRootContent(root: HTMLElement): Promise<void> {
  if (root.firstElementChild) return;
  await new Promise<void>(resolve => {
    const observer = new MutationObserver(() => {
      if (!root.firstElementChild) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(root, { childList: true });
  });
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForFirstScreen(): Promise<void> {
  const root = appRoot();
  if (!root) return;
  await waitForRootContent(root);
  await waitForPaint();
  await Promise.all([document.fonts.ready, waitForImages(root)]);
  await waitForPaint();
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
  root: HTMLElement | null,
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
  await fade.finished.catch(() => {});
  finishSplash(splash, root);
}

async function revealWithBlink(
  splash: HTMLElement,
  root: HTMLElement,
): Promise<void> {
  const resize = () => updateRevealGeometry(splash, root);
  resize();
  window.addEventListener("resize", resize);
  splash.classList.add("is-revealing");
  root.classList.add(ROOT_REVEAL_CLASS);
  await wait(LAUNCH_SPLASH_REVEAL_MS);
  window.removeEventListener("resize", resize);
  finishSplash(splash, root);
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

  await waitForFirstScreen();
  if (reducedMotionRequested(appReduceMotion)) {
    await revealWithReducedMotion(splash, root);
    return;
  }

  const elapsed = animationElapsed(splash);
  await wait(Math.max(0, nextLaunchSplashBeatBoundary(elapsed) - elapsed));
  if (reducedMotionRequested(appReduceMotion)) {
    await revealWithReducedMotion(splash, root);
    return;
  }
  if (!root) {
    finishSplash(splash, null);
    return;
  }
  await revealWithBlink(splash, root);
}
