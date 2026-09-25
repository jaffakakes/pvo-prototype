import { readPvo } from "../packages/pvo-sdk/index.js";

const refs = {
  input: document.querySelector("#pvoInput"),
  empty: document.querySelector("#emptyState"),
  dropZone: document.querySelector("#dropZone"),
  shell: document.querySelector("#playerShell"),
  frame: document.querySelector("#playerFrame"),
  video: document.querySelector("#video"),
  overlay: document.querySelector("#overlayLayer"),
  endScreen: document.querySelector("#endScreen"),
  endRestart: document.querySelector("#endRestartButton"),
  centerPlay: document.querySelector("#centerPlayButton"),
  controls: document.querySelector("#playerControls"),
  restart: document.querySelector("#restartButton"),
  play: document.querySelector("#playButton"),
  mute: document.querySelector("#muteButton"),
  volume: document.querySelector("#volumeControl"),
  progress: document.querySelector("#progress"),
  fullscreen: document.querySelector("#fullscreenButton"),
  share: document.querySelector("#shareButton"),
  endShare: document.querySelector("#endShareButton"),
  timeline: document.querySelector("#timelineLabel"),
  time: document.querySelector("#timeLabel"),
  status: document.querySelector("#status"),
};

let manifest = null;
let assets = new Map();
let assetUrls = new Map();
let currentTimeline = null;
let currentClipIndex = 0;
let switchingClip = false;
let loadToken = 0;
let awaitingComponent = null;
let finished = false;
let answers = new Map();
let handledBranches = new Set();
let renderedOverlayKey = "";
let controlsTimer = null;
let resumeAfterScrub = false;

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (["href", "src"].includes(name) && /^javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function sanitizeCss(css) {
  return String(css || "").replace(/@import[^;]+;/gi, "").replace(/url\([^)]*\)/gi, "none");
}

function normalizeAnswer(value) {
  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  return Boolean(value);
}

class PvoComponentView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("change", (event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
      if ((control.type === "radio" || control.type === "checkbox") && !control.checked) return;
      this.sendAnswer(control.value || control.checked);
    });
    this.shadowRoot.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      event.preventDefault();
      this.sendAnswer(button.value || "true");
    });
    this.shadowRoot.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendAnswer("true");
    });
  }

  update(component, answer) {
    this.componentId = component.id;
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; width: 100%; height: 100%; }
      * { box-sizing: border-box; }
      .component-root { width: 100%; height: 100%; }
      ${sanitizeCss(component.css)}
    </style><div class="component-root">${sanitizeHtml(component.html)}</div>`;
    if (answer !== undefined) {
      this.shadowRoot.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
        input.checked = normalizeAnswer(input.value) === answer;
      });
    }
  }

  sendAnswer(value) {
    this.dispatchEvent(new CustomEvent("pvo-answer", {
      bubbles: true,
      composed: true,
      detail: { componentId: this.componentId, answer: normalizeAnswer(value) },
    }));
  }
}
customElements.define("pvo-component-view", PvoComponentView);

function setStatus(message, error = false, visible = error) {
  refs.status.textContent = message;
  refs.status.classList.toggle("error", error);
  refs.status.classList.toggle("is-visible", Boolean(message) && visible);
}

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function timelineDuration(timeline = currentTimeline) {
  return (timeline?.clips || []).reduce((total, clip) => total + Math.max(0, clip.end - clip.start), 0);
}

function elapsedTime() {
  if (!currentTimeline) return 0;
  const before = currentTimeline.clips.slice(0, currentClipIndex)
    .reduce((total, clip) => total + Math.max(0, clip.end - clip.start), 0);
  const clip = currentTimeline.clips[currentClipIndex];
  return before + Math.max(0, Math.min(clip.end - clip.start, refs.video.currentTime - clip.start));
}

function clipAtElapsedTime(value) {
  const clips = currentTimeline?.clips || [];
  const total = timelineDuration();
  const targetTime = Math.max(0, Math.min(Number(value) || 0, total));
  let cursor = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const duration = Math.max(0, clips[index].end - clips[index].start);
    const isLast = index === clips.length - 1;
    if (targetTime < cursor + duration || isLast) {
      return { index, local: Math.max(0, Math.min(duration - .01, targetTime - cursor)) };
    }
    cursor += duration;
  }
  return null;
}

function updateProgress() {
  const elapsed = elapsedTime();
  const total = timelineDuration();
  refs.progress.max = Math.max(total, 1);
  refs.progress.value = Math.min(elapsed, total);
  refs.progress.style.setProperty("--progress", `${total ? elapsed / total * 100 : 0}%`);
  refs.time.textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
  const paused = refs.video.paused;
  refs.play.textContent = paused ? "▶" : "❚❚";
  refs.play.setAttribute("aria-label", paused ? "Play" : "Pause");
  refs.mute.textContent = refs.video.muted ? "🔇" : "🔊";
  refs.mute.setAttribute("aria-label", refs.video.muted ? "Unmute" : "Mute");
  if (refs.volume) refs.volume.value = refs.video.muted ? 0 : refs.video.volume;
  refs.centerPlay.hidden = !paused || Boolean(awaitingComponent) || finished || switchingClip;
}

function hideControls() {
  if (switchingClip || refs.video.paused || finished || awaitingComponent) return;
  refs.frame.classList.remove("controls-visible");
}

function showControls(sticky = false) {
  refs.frame.classList.add("controls-visible");
  window.clearTimeout(controlsTimer);
  controlsTimer = null;
  if (!sticky) controlsTimer = window.setTimeout(hideControls, 2600);
}

function activeClip() {
  return currentTimeline?.clips?.[currentClipIndex] || null;
}

function componentMatchesClip(component, clip) {
  const presentation = component.presentation || {};
  return presentation.clip
    ? presentation.clip === (clip.source_clip || clip.id)
    : presentation.scene === clip.scene;
}

function componentsForClip(clip = activeClip()) {
  if (!clip) return [];
  return (manifest?.components || []).filter((component) => componentMatchesClip(component, clip));
}

function localClipTime() {
  const clip = activeClip();
  return clip ? Math.max(0, refs.video.currentTime - clip.start) : 0;
}

function visibleComponents() {
  const local = localClipTime();
  return componentsForClip().filter((component) => {
    const presentation = component.presentation || {};
    if (awaitingComponent?.id === component.id) return true;
    return local >= Number(presentation.start || 0) && local < Number(presentation.end || 0);
  });
}

function renderOverlays(force = false) {
  const visible = finished ? [] : visibleComponents();
  const key = visible.map((component) => `${component.id}:${String(answers.get(component.id))}`).join("|");
  if (!force && key === renderedOverlayKey) return;
  renderedOverlayKey = key;
  refs.overlay.innerHTML = "";
  visible.forEach((component) => {
    const presentation = component.presentation || {};
    const position = document.createElement("div");
    const interactive = ["choice", "form"].includes(component.kind);
    position.className = `component-position${interactive ? " interactive" : ""}`;
    position.style.left = `${Number(presentation.x || 0) * 100}%`;
    position.style.top = `${Number(presentation.y || 0) * 100}%`;
    position.style.width = `${Number(presentation.width || 1) * 100}%`;
    position.style.height = `${Number(presentation.height || 1) * 100}%`;
    const view = document.createElement("pvo-component-view");
    view.update(component, answers.get(component.id));
    position.append(view);
    refs.overlay.append(position);
  });
}

function revokeAssetUrls() {
  assetUrls.forEach((url) => URL.revokeObjectURL(url));
  assetUrls = new Map();
}

function timelineById(id) {
  return manifest?.playback?.timelines?.find((timeline) => timeline.id === id) || null;
}

function waitForVideo(eventName, token) {
  return new Promise((resolve, reject) => {
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("This media cannot be played in the browser.")); };
    const cleanup = () => {
      refs.video.removeEventListener(eventName, onEvent);
      refs.video.removeEventListener("error", onError);
    };
    refs.video.addEventListener(eventName, onEvent, { once: true });
    refs.video.addEventListener("error", onError, { once: true });
    if (token !== loadToken) { cleanup(); resolve(); }
  });
}

async function loadClip(index, autoplay = false) {
  const clip = currentTimeline?.clips?.[index];
  if (!clip) return finishExperience();
  const asset = assets.get(clip.asset_id);
  const url = assetUrls.get(clip.asset_id);
  if (!asset || !url) throw new Error(`PVO media "${clip.asset_id}" is missing.`);
  const token = ++loadToken;
  switchingClip = true;
  refs.video.pause();
  currentClipIndex = index;
  renderedOverlayKey = "";
  refs.timeline.textContent = currentTimeline.kind === "branch"
    ? `${currentTimeline.condition === "true" ? "Yes" : "No"} branch`
    : "Main timeline";
  if (refs.video.dataset.assetId !== clip.asset_id) {
    refs.video.dataset.assetId = clip.asset_id;
    refs.video.src = url;
    refs.video.load();
    await waitForVideo("loadedmetadata", token);
  }
  if (token !== loadToken) return;
  refs.video.currentTime = Math.max(0, clip.start);
  switchingClip = false;
  renderOverlays(true);
  updateProgress();
  if (autoplay) {
    await refs.video.play().catch(() => {
      setStatus("Tap to play", false, true);
      showControls();
    });
  }
}

async function seekToElapsed(value, autoplay = false) {
  if (!currentTimeline || finished || awaitingComponent) return;
  const target = clipAtElapsedTime(value);
  if (!target) return;
  if (target.index !== currentClipIndex) await loadClip(target.index, false);
  const clip = activeClip();
  if (!clip) return;
  refs.video.currentTime = Math.min(clip.end - .01, clip.start + target.local);
  renderedOverlayKey = "";
  renderOverlays(true);
  updateProgress();
  if (autoplay) await refs.video.play().catch(() => showControls());
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (refs.frame.requestFullscreen) {
      await refs.frame.requestFullscreen();
    } else if (refs.video.webkitEnterFullscreen) {
      refs.video.webkitEnterFullscreen();
    }
  } catch {
    setStatus("Full screen is unavailable in this browser.", true);
  }
}

async function shareExperience() {
  const url = new URL(window.location.href);
  url.hash = "";
  const shareData = {
    title: document.title,
    text: "What would you choose? Play this interactive video.",
    url: url.href,
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(url.href);
      setStatus("Link copied", false, true);
      window.setTimeout(() => setStatus(""), 1600);
    }
  } catch (error) {
    if (error?.name !== "AbortError") setStatus("Could not share this link.", true);
  }
}

function routeForAnswer(component, answer) {
  const condition = answer ? "true" : "false";
  return component.scene_change?.routes?.find((route) => route.condition === condition) || null;
}

async function startSelectedBranch(component) {
  const answer = answers.get(component.id);
  if (answer === undefined || handledBranches.has(component.id)) return;
  const route = routeForAnswer(component, answer);
  const target = timelineById(route?.timelineId);
  if (!target) {
    finishExperience();
    setStatus("The selected branch is missing from this PVO.", true);
    return;
  }
  handledBranches.add(component.id);
  awaitingComponent = null;
  currentTimeline = target;
  setStatus("");
  await loadClip(0, true);
}

function branchAtCurrentTime() {
  if (currentTimeline?.kind !== "main") return false;
  const local = localClipTime();
  const component = componentsForClip()
    .filter((item) => item.scene_change?.enabled && !handledBranches.has(item.id))
    .sort((a, b) => Number(a.presentation?.end || 0) - Number(b.presentation?.end || 0))
    .find((item) => local >= Number(item.presentation?.end || 0) - 0.04);
  if (!component) return false;
  if (!answers.has(component.id)) {
    if (awaitingComponent?.id === component.id) return true;
    awaitingComponent = component;
    refs.video.pause();
    const clip = activeClip();
    refs.video.currentTime = Math.min(clip.end, clip.start + Number(component.presentation?.end || 0));
    renderOverlays(true);
    updateProgress();
    setStatus("");
    showControls();
    return true;
  }
  void startSelectedBranch(component);
  return true;
}

function advanceAtClipEnd(force = false) {
  const clip = activeClip();
  if (!clip || switchingClip || finished) return;
  if (!force && refs.video.currentTime < clip.end - 0.04) return;
  if (branchAtCurrentTime()) return;
  const next = currentClipIndex + 1;
  if (next < currentTimeline.clips.length) {
    void loadClip(next, true).catch((error) => setStatus(error.message, true));
    return;
  }
  finishExperience();
}

function finishExperience() {
  refs.video.pause();
  finished = true;
  awaitingComponent = null;
  refs.endScreen.hidden = false;
  renderOverlays(true);
  updateProgress();
  setStatus("");
  showControls();
}

async function restartExperience(autoplay = true) {
  if (!manifest) return;
  answers = new Map();
  handledBranches = new Set();
  awaitingComponent = null;
  finished = false;
  renderedOverlayKey = "";
  refs.endScreen.hidden = true;
  currentTimeline = timelineById(manifest.playback.initial_timeline);
  setStatus("");
  await loadClip(0, autoplay);
}

async function openPvo(file, { autoplay = false } = {}) {
  if (!file) return;
  setStatus("Loading…", false, true);
  try {
    const decoded = await readPvo(file);
    if (!decoded.container || !decoded.manifest?.playback?.timelines?.length) {
      throw new Error("Choose a self-contained .pvo file exported by this editor.");
    }
    if (!decoded.validation.valid) throw new Error(decoded.validation.errors[0] || "The PVO manifest is invalid.");
    revokeAssetUrls();
    manifest = decoded.manifest;
    assets = new Map(decoded.assets.map((asset) => [asset.id, asset]));
    decoded.assets.forEach((asset) => assetUrls.set(asset.id, URL.createObjectURL(asset.blob)));
    const ratio = manifest.canvas?.ratio || "16:9";
    const [width, height] = ratio.split(":").map(Number);
    refs.frame.style.aspectRatio = width > 0 && height > 0 ? `${width} / ${height}` : "16 / 9";
    refs.frame.style.setProperty("--aspect", width > 0 && height > 0 ? String(width / height) : String(16 / 9));
    refs.empty.hidden = true;
    refs.shell.hidden = false;
    await restartExperience(autoplay);
    if (!autoplay) showControls();
    if (!refs.video.paused) setStatus("");
  } catch (error) {
    setStatus(`Could not open PVO · ${error.message}`, true);
    refs.empty.hidden = false;
  }
}

async function openPvoUrl(source, { autoplay = true } = {}) {
  try {
    const url = new URL(source, window.location.href);
    if (url.origin !== window.location.origin) throw new Error("The video must be hosted with this player.");
    setStatus("Loading…", false, true);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Video could not be loaded (${response.status}).`);
    const blob = await response.blob();
    await openPvo(blob, { autoplay });
  } catch (error) {
    setStatus(error.message, true);
    refs.empty.hidden = false;
  }
}

function handleInput(event) {
  const [file] = event.target.files;
  void openPvo(file, { autoplay: true });
  event.target.value = "";
}

function togglePlayback() {
  if (finished) { void restartExperience(true); return; }
  if (awaitingComponent) { showControls(); return; }
  if (refs.video.paused) void refs.video.play().catch(() => setStatus("Playback could not start.", true));
  else refs.video.pause();
}

refs.input?.addEventListener("change", handleInput);
refs.play.addEventListener("click", togglePlayback);
refs.centerPlay.addEventListener("click", togglePlayback);
refs.restart.addEventListener("click", () => { void restartExperience(true); });
refs.endRestart.addEventListener("click", () => { void restartExperience(true); });
refs.mute.addEventListener("click", () => {
  refs.video.muted = !refs.video.muted;
  updateProgress();
  showControls();
});
refs.volume?.addEventListener("input", () => {
  refs.video.volume = Number(refs.volume.value);
  refs.video.muted = refs.video.volume === 0;
  updateProgress();
  showControls(true);
});
refs.progress.addEventListener("pointerdown", () => {
  resumeAfterScrub = !refs.video.paused;
  refs.video.pause();
  showControls(true);
});
refs.progress.addEventListener("input", () => { void seekToElapsed(Number(refs.progress.value)); });
refs.progress.addEventListener("change", () => {
  const shouldResume = resumeAfterScrub;
  resumeAfterScrub = false;
  void seekToElapsed(Number(refs.progress.value), shouldResume);
  showControls();
});
refs.fullscreen.addEventListener("click", () => { void toggleFullscreen(); });
refs.share?.addEventListener("click", () => { void shareExperience(); });
refs.endShare?.addEventListener("click", () => { void shareExperience(); });
refs.video.addEventListener("click", togglePlayback);
refs.video.addEventListener("play", () => {
  setStatus("");
  updateProgress();
  showControls(false);
});
refs.video.addEventListener("pause", () => {
  updateProgress();
  if (!switchingClip) showControls();
});
refs.video.addEventListener("timeupdate", () => {
  if (switchingClip || finished) return;
  renderOverlays();
  updateProgress();
  if (!branchAtCurrentTime()) advanceAtClipEnd();
});
refs.video.addEventListener("ended", () => advanceAtClipEnd(true));
refs.overlay.addEventListener("pvo-answer", (event) => {
  const component = manifest?.components?.find((item) => item.id === event.detail.componentId);
  if (!component) return;
  answers.set(component.id, event.detail.answer);
  if (awaitingComponent?.id === component.id) void startSelectedBranch(component);
  else {
    renderOverlays(true);
    setStatus("");
  }
});

["pointermove", "pointerdown", "touchstart"].forEach((eventName) => refs.frame.addEventListener(eventName, () => showControls(), { passive: true }));
refs.frame.addEventListener("focusin", () => showControls(true));
refs.frame.addEventListener("focusout", () => showControls());
document.addEventListener("keydown", (event) => {
  if (refs.shell.hidden) return;
  const tag = event.target?.tagName;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
  const key = event.key.toLowerCase();
  if (![" ", "arrowleft", "arrowright", "m", "f", "r"].includes(key)) return;
  event.preventDefault();
  showControls();
  if (key === " ") togglePlayback();
  else if (key === "arrowleft") void seekToElapsed(elapsedTime() - 5, !refs.video.paused);
  else if (key === "arrowright") void seekToElapsed(elapsedTime() + 5, !refs.video.paused);
  else if (key === "m") refs.mute.click();
  else if (key === "f") void toggleFullscreen();
  else if (key === "r") void restartExperience(true);
});
document.addEventListener("fullscreenchange", () => {
  const expanded = Boolean(document.fullscreenElement);
  refs.fullscreen.textContent = expanded ? "✕" : "⛶";
  refs.fullscreen.setAttribute("aria-label", expanded ? "Exit full screen" : "Enter full screen");
  showControls();
});

["dragenter", "dragover"].forEach((eventName) => refs.dropZone?.addEventListener(eventName, (event) => {
  event.preventDefault();
  refs.dropZone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((eventName) => refs.dropZone?.addEventListener(eventName, (event) => {
  event.preventDefault();
  refs.dropZone.classList.remove("is-dragging");
}));
refs.dropZone?.addEventListener("drop", (event) => { void openPvo(event.dataTransfer.files[0], { autoplay: true }); });
window.addEventListener("beforeunload", revokeAssetUrls);

const requestedSource = new URLSearchParams(window.location.search).get("src") || document.body.dataset.pvoSrc;
if (requestedSource) {
  const autoplay = document.body.dataset.autoplay !== "false";
  refs.empty.hidden = true;
  refs.shell.hidden = false;
  if (autoplay) refs.video.muted = true;
  updateProgress();
  void openPvoUrl(requestedSource, { autoplay });
}
