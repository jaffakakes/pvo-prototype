import { packPvo, PVO_SPEC_VERSION } from "../packages/pvo-sdk/index.js";

const $ = (selector) => document.querySelector(selector);
const video = $("#video");
const videoArea = $("#videoArea");
const canvasFrame = $("#canvasFrame");
const overlayLayer = $("#overlayLayer");
const clipTrack = $("#clipTrack");
const componentLayers = $("#componentLayers");
const timelineEditor = $("#timelineEditor");
const ruler = $("#ruler");
const trackWrap = document.querySelector(".track-wrap");
const addComponentButtons = [...document.querySelectorAll("[data-add-component]")];

const refs = {
  projectName: $("#projectName"), projectDuration: $("#projectDuration"),
  sceneName: $("#sceneName"), currentTime: $("#currentTime"), totalTime: $("#totalTime"),
  inspectorFields: $("#inspectorFields"), componentDialog: $("#componentDialog"),
  dialogTitle: $("#componentDialogTitle"), routingSection: $("#sceneRoutingSection"),
  routeFields: $("#sceneRouteFields"), routeSource: $("#routeSourceScene"), routeList: $("#sceneRouteList"),
  changeSceneToggle: $("#changeSceneToggle"), canvasRatio: $("#canvasRatio"),
  mediaStart: $("#mediaStart"), mediaStartTitle: $("#mediaStartTitle"), mediaStartMessage: $("#mediaStartMessage"),
  splitButton: $("#splitButton"), deleteClipButton: $("#deleteClipButton"),
  mediaTab: $("#mediaTab"), componentsTab: $("#componentsTab"),
  mediaPanel: $("#mediaPanel"), componentsPanel: $("#componentsPanel"),
  mediaLibrary: $("#mediaLibrary"), mediaCount: $("#mediaCount"),
  exportPvoButton: $("#exportPvoButton"), exportHelp: $("#exportHelp"),
  timelineTitle: $("#timelineTitle"), timelineSubtitle: $("#timelineSubtitle"),
  timelineView: $("#timelineView"), mainTimelineButton: $("#mainTimelineButton"),
  name: $("#componentName"), x: $("#componentX"), y: $("#componentY"),
  width: $("#componentW"), height: $("#componentH"), html: $("#componentHtml"), css: $("#componentCss"),
  playhead: $("#playhead"), status: $("#status"), videoInput: $("#videoInput"),
};

const canvasRatios = {
  "16:9": { width: 16, height: 9 },
  "9:16": { width: 9, height: 16 },
  "1:1": { width: 1, height: 1 },
  "4:5": { width: 4, height: 5 },
};

const presets = {
  tooltip: {
    name: "Tooltip",
    html: '<div class="tooltip">Tap for more</div>',
    css: `.tooltip {
  padding: 8px 10px;
  border-radius: 6px;
  background: #111827;
  color: white;
  font: 600 14px Arial, sans-serif;
  box-shadow: 0 6px 20px rgba(0,0,0,.25);
}`,
    x: 58, y: 24, width: 24, height: 12,
  },
  card: {
    name: "Card",
    html: '<div class="card"><h3>Card title</h3><p>Add a short explanation here.</p></div>',
    css: `.card {
  padding: 16px;
  border-radius: 10px;
  background: rgba(255,255,255,.94);
  color: #171717;
  font-family: Arial, sans-serif;
  box-shadow: 0 12px 32px rgba(0,0,0,.28);
}
.card h3 { margin: 0 0 6px; font-size: 18px; }
.card p { margin: 0; font-size: 14px; line-height: 1.4; }`,
    x: 6, y: 58, width: 36, height: 27,
  },
  choice: {
    name: "Choice",
    html: '<fieldset class="choice"><legend>Do you want to hear more?</legend><label><input type="radio" name="answer" value="true"> Yes</label><label><input type="radio" name="answer" value="false"> No</label></fieldset>',
    css: `.choice {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin: 0;
  padding: 18px;
  border: 1px solid #d7d7d7;
  border-radius: 8px;
  background: #ffffff;
  color: #111111;
  font-family: Arial, sans-serif;
  box-shadow: 0 10px 28px rgba(0,0,0,.18);
}
.choice legend { margin-bottom: 6px; padding: 0; font-size: 18px; font-weight: 700; }
.choice label { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #dddddd; border-radius: 5px; color: #111111; background: #ffffff; cursor: pointer; }
.choice label:has(input:checked) { border-color: #111111; background: #f2f2f2; }
.choice input { width: 16px; height: 16px; margin: 0; accent-color: #111111; }`,
    x: 25, y: 54, width: 50, height: 38,
  },
  form: {
    name: "Form",
    html: '<form class="form"><label>Name<input placeholder="Your name"></label><button type="button">Submit</button></form>',
    css: `.form {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 10px;
  background: #ffffff;
  color: #111111;
  font: 600 13px Arial, sans-serif;
  box-shadow: 0 10px 28px rgba(0,0,0,.18);
}
.form label { display: grid; gap: 5px; }
.form input { padding: 8px; border: 1px solid #bbb; border-radius: 5px; }
.form button { padding: 9px; border: 0; border-radius: 5px; background: #171717; color: white; }`,
    x: 60, y: 50, width: 32, height: 35,
  },
};

let mediaItems = [];
let clips = [];
let components = [];
let selectedClipId = null;
let selectedComponentId = null;
let activeMediaId = null;
let loadedMediaId = null;
let pendingPreview = null;
let timelineViewKey = "main";
let canvasRatio = "16:9";
let mediaReady = false;
let exporting = false;
let switchingClip = false;
let previousPreviewTime = 0;
let executedSceneChanges = new Set();
let mediaCounter = 0;
let clipCounter = 0;
let sceneCounter = 0;
let componentCounter = 0;

class EditorOverlay extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("change", (event) => {
      if (!this.interactive) return;
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
      this.dispatchAnswer(control.value, control.checked);
    });
    this.shadowRoot.addEventListener("click", (event) => {
      if (!this.interactive) return;
      const button = event.target.closest?.("button");
      if (!button) return;
      event.preventDefault();
      this.dispatchAnswer("true", true);
    });
  }

  update(component) {
    this.interactive = isBranchingComponent(component);
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; width:100%; height:100%; }
      * { box-sizing:border-box; }
      .component-root { width:100%; height:100%; }
      ${sanitizeCss(component.css)}
    </style><div class="component-root">${sanitizeHtml(component.html)}</div>`;
    if (component.pendingAnswer !== undefined) {
      this.shadowRoot.querySelectorAll('input[type="radio"]').forEach((input) => {
        input.checked = String(input.value).toLowerCase() === String(component.pendingAnswer);
      });
    }
  }

  dispatchAnswer(value, checked) {
    if (!checked) return;
    const normalized = String(value).toLowerCase();
    const answer = normalized === "true" ? true : normalized === "false" ? false : value;
    this.dispatchEvent(new CustomEvent("pvo-answer", { bubbles: true, composed: true, detail: { answer } }));
  }
}
customElements.define("editor-overlay", EditorOverlay);

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
      if (["href", "src"].includes(attribute.name.toLowerCase()) && /^javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function sanitizeCss(css) {
  return String(css || "").replace(/@import[^;]+;/gi, "").replace(/url\([^)]*\)/gi, "none");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(message) {
  refs.status.textContent = message;
}

function mediaItem(id) {
  return mediaItems.find((item) => item.id === id) || null;
}

function activeMediaItem() {
  return mediaItem(activeMediaId);
}

function selectedClip() {
  return clips.find((clip) => clip.id === selectedClipId) || null;
}

function selectedComponent() {
  return components.find((component) => component.id === selectedComponentId) || null;
}

function mediaItemIsMov(item) {
  return /(?:\.pvo)?\.mov$/i.test(item?.name || "") || item?.file?.type === "video/quicktime";
}

function clipDuration(clip) {
  return clip ? Math.max(0, clip.sourceEnd - clip.sourceStart) : 0;
}

function sceneLabelFromFile(name) {
  return name.replace(/\.pvo\.(mp4|mov)$/i, "").replace(/\.(mp4|mov)$/i, "") || `Scene ${sceneCounter + 1}`;
}

function currentLocalTime() {
  const clip = selectedClip();
  if (!clip || loadedMediaId !== clip.mediaId) return 0;
  return clamp(video.currentTime - clip.sourceStart, 0, clipDuration(clip));
}

function branchViewOptions() {
  return components.flatMap((component) => {
    if (!component.sceneChange?.enabled) return [];
    const routes = binaryMediaRoutes(component);
    const validRoutes = routes.filter((route) => mediaItem(route.mediaId) && clips.some((clip) => clip.mediaId === route.mediaId));
    if (validRoutes.length !== 2) return [];
    return validRoutes.map((route) => ({
      key: `branch:${component.id}:${route.condition}`,
      componentId: component.id,
      condition: route.condition,
      mediaId: route.mediaId,
      label: `${component.name} — ${route.condition === "true" ? "Yes" : "No"}`,
    }));
  });
}

function currentBranchView() {
  return branchViewOptions().find((view) => view.key === timelineViewKey) || null;
}

function visibleClips() {
  const branch = currentBranchView();
  return branch ? clips.filter((clip) => clip.mediaId === branch.mediaId) : clips;
}

function clipLayouts(viewClips = visibleClips()) {
  let cursor = 0;
  return viewClips.map((clip) => {
    const start = cursor;
    cursor += clipDuration(clip);
    return { clip, start, end: cursor, duration: clipDuration(clip) };
  });
}

function viewDuration() {
  return clipLayouts().at(-1)?.end || 0;
}

function projectDuration() {
  return clipLayouts(clips).at(-1)?.end || 0;
}

function selectedLayout() {
  return clipLayouts().find((layout) => layout.clip.id === selectedClipId) || null;
}

function timelineTime() {
  const layout = selectedLayout();
  return layout ? layout.start + currentLocalTime() : 0;
}

function canExportTimeline() {
  return clips.length > 0 && new Set(clips.map((clip) => clip.mediaId)).size === 1;
}

function renderExportState() {
  const canExport = canExportTimeline();
  refs.exportPvoButton.disabled = !mediaReady || !canExport || exporting;
  refs.exportHelp.textContent = canExport
    ? "Exports this single-source timeline with its PVO interaction data attached."
    : "Multi-media preview is ready. Combining its media into one rendered video is the next export step.";
}

function setMediaReady(ready, copy = {}) {
  mediaReady = ready;
  const hasClips = clips.length > 0;
  const hasReusableMedia = mediaItems.some((item) => item.duration && !item.error);
  refs.mediaStart.hidden = ready;
  canvasFrame.hidden = !ready;
  refs.canvasRatio.disabled = !hasClips;
  refs.splitButton.disabled = !ready;
  refs.deleteClipButton.disabled = !selectedClip();
  refs.playhead.hidden = !hasClips;
  refs.sceneName.disabled = !hasClips;
  timelineEditor.classList.toggle("is-empty", !hasClips);
  addComponentButtons.forEach((button) => { button.disabled = !ready; });
  if (!ready) {
    refs.mediaStartTitle.textContent = copy.title || (hasClips ? "Loading preview…" : hasReusableMedia ? "Add media to the timeline" : "Add media to start");
    refs.mediaStartMessage.textContent = copy.message || (hasClips ? "Preparing the selected clip." : hasReusableMedia ? "Choose an imported file in Media to add it back." : "Use Add media in the top-right corner.");
  }
  renderExportState();
  renderMediaLibrary();
}

function setPanelTab(name) {
  const showMedia = name === "media";
  refs.mediaTab.setAttribute("aria-selected", String(showMedia));
  refs.componentsTab.setAttribute("aria-selected", String(!showMedia));
  refs.mediaTab.tabIndex = showMedia ? 0 : -1;
  refs.componentsTab.tabIndex = showMedia ? -1 : 0;
  refs.mediaPanel.hidden = !showMedia;
  refs.componentsPanel.hidden = showMedia;
}

function renderMediaLibrary() {
  const count = mediaItems.length;
  refs.mediaCount.textContent = `${count} ${count === 1 ? "item" : "items"}`;
  refs.mediaLibrary.innerHTML = "";
  if (!count) {
    const empty = document.createElement("p");
    empty.className = "media-empty";
    empty.textContent = "Imported media appears here and is appended to the timeline.";
    refs.mediaLibrary.append(empty);
    return;
  }
  mediaItems.forEach((item) => {
    const active = item.id === activeMediaId;
    const onTimeline = clips.some((clip) => clip.mediaId === item.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `media-item${active ? " active" : ""}${item.error ? " error" : ""}`;
    button.setAttribute("aria-pressed", String(active));
    const main = document.createElement("span");
    main.className = "media-item-main";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const metadata = document.createElement("span");
    const details = [mediaItemIsMov(item) ? "MOV" : "MP4", formatFileSize(item.file.size)];
    if (item.duration) details.push(formatTime(item.duration));
    else if (!item.error) details.push("Loading…");
    metadata.textContent = details.join(" · ");
    main.append(name, metadata);
    const state = document.createElement("span");
    state.className = "media-item-state";
    if (item.error) state.textContent = "Could not open";
    else if (active && onTimeline) state.textContent = "Selected";
    else if (onTimeline) state.textContent = "On timeline";
    else state.textContent = "Add to timeline";
    button.append(main, state);
    button.addEventListener("click", () => {
      const clip = clips.find((candidate) => candidate.mediaId === item.id);
      if (!clip) {
        if (!item.duration || item.error) return;
        const restoredClip = appendMediaClip(item);
        setTimelineView("main", false);
        selectClip(restoredClip.id);
        setStatus(`${item.name} added back after the last clip`);
        return;
      }
      setTimelineView("main", false);
      selectClip(clip.id);
    });
    refs.mediaLibrary.append(button);
  });
}

function renderTimelineNavigation() {
  const views = branchViewOptions();
  if (timelineViewKey !== "main" && !views.some((view) => view.key === timelineViewKey)) timelineViewKey = "main";
  refs.timelineView.innerHTML = "";
  const main = document.createElement("option");
  main.value = "main";
  main.textContent = "Main timeline";
  refs.timelineView.append(main);
  views.forEach((view) => {
    const option = document.createElement("option");
    option.value = view.key;
    option.textContent = view.label;
    refs.timelineView.append(option);
  });
  refs.timelineView.value = timelineViewKey;
  const branch = currentBranchView();
  refs.mainTimelineButton.hidden = !branch;
  refs.timelineTitle.textContent = branch?.label || "Main timeline";
  refs.timelineSubtitle.textContent = branch
    ? `Branch media · ${mediaItem(branch.mediaId)?.name || "Missing media"}`
    : "All media and UI layers";
}

function setTimelineView(key, selectTarget = true) {
  timelineViewKey = key;
  renderTimelineNavigation();
  const viewClips = visibleClips();
  if (selectTarget && viewClips.length && !viewClips.some((clip) => clip.id === selectedClipId)) {
    selectClip(viewClips[0].id);
    return;
  }
  renderAll();
  updateTimeDisplay();
}

function loadClipPreview(clip, localTime = 0, autoplay = false) {
  const item = mediaItem(clip.mediaId);
  if (!item || item.error) return;
  const sourceTime = clip.sourceStart + clamp(localTime, 0, Math.max(0, clipDuration(clip) - 0.01));
  activeMediaId = item.id;
  previousPreviewTime = localTime;
  renderMediaLibrary();
  if (loadedMediaId === item.id && video.src) {
    video.currentTime = sourceTime;
    setMediaReady(true);
    renderAll();
    updateTimeDisplay();
    if (autoplay) void video.play().catch(() => {});
    return;
  }
  pendingPreview = { clipId: clip.id, mediaId: item.id, sourceTime, autoplay };
  switchingClip = true;
  setMediaReady(false, { title: "Loading preview…", message: `Preparing ${item.name}` });
  video.src = item.url;
  video.load();
}

function selectClip(id, seek = true, autoplay = false) {
  const clip = clips.find((candidate) => candidate.id === id);
  if (!clip) return;
  selectedClipId = clip.id;
  selectedComponentId = components.find((component) => component.clipId === clip.id)?.id || null;
  renderAll();
  if (seek) loadClipPreview(clip, 0, autoplay);
}

function renameSelectedScene(value) {
  const clip = selectedClip();
  if (!clip) return;
  const name = value.trim() || "Untitled scene";
  clips.filter((candidate) => candidate.sceneId === clip.sceneId).forEach((candidate) => { candidate.sceneName = name; });
  refs.sceneName.value = name;
  renderTimeline();
  setStatus(`Scene renamed to ${name}`);
}

function probeMedia(item) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement("video");
    const cleanup = () => { probe.removeAttribute("src"); probe.load(); };
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const duration = Number(probe.duration);
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error("Video has no readable duration"));
    };
    probe.onerror = () => { cleanup(); reject(new Error("This codec cannot be opened in the browser")); };
    probe.src = item.url;
  });
}

function appendMediaClip(item) {
  const clip = {
    id: `clip_${++clipCounter}`,
    mediaId: item.id,
    sceneId: `scene_${++sceneCounter}`,
    sceneName: sceneLabelFromFile(item.name),
    sourceStart: 0,
    sourceEnd: item.duration,
  };
  clips.push(clip);
  return clip;
}

async function importMediaFiles(files) {
  const supported = files.filter((file) => /\.(mp4|mov)$/i.test(file.name) || ["video/mp4", "video/quicktime"].includes(file.type));
  if (!supported.length) {
    setStatus("Choose MP4 or MOV files");
    return;
  }
  setPanelTab("media");
  for (const file of supported) {
    const item = {
      id: `media_${++mediaCounter}`,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      duration: null,
      error: false,
    };
    mediaItems.push(item);
    renderMediaLibrary();
    try {
      item.duration = await probeMedia(item);
      const clip = appendMediaClip(item);
      if (!selectedClipId) selectClip(clip.id);
      else renderAll();
      setStatus(`${item.name} added after the last clip`);
    } catch (error) {
      item.error = true;
      setStatus(`${item.name} could not be opened · ${error.message}`);
    }
    renderMediaLibrary();
  }
  refs.projectName.textContent = mediaItems.length === 1 ? mediaItems[0].name : "PVO project";
  refs.projectDuration.textContent = formatTime(projectDuration());
  renderAll();
}

function splitClipAt(localTime) {
  const clip = selectedClip();
  if (!clip) throw new Error("Select a clip first");
  const duration = clipDuration(clip);
  const at = clamp(localTime, 0, duration);
  if (at <= 0.08 || at >= duration - 0.08) {
    const message = "Split time must be inside the selected clip and away from its edges";
    setStatus(message);
    throw new Error(message);
  }
  const oldSourceEnd = clip.sourceEnd;
  const splitSourceTime = clip.sourceStart + at;
  clip.sourceEnd = splitSourceTime;
  const right = { ...clip, id: `clip_${++clipCounter}`, sourceStart: splitSourceTime, sourceEnd: oldSourceEnd };
  const index = clips.findIndex((candidate) => candidate.id === clip.id);
  clips.splice(index + 1, 0, right);
  components.filter((component) => component.clipId === clip.id).forEach((component) => {
    if (component.start >= at) {
      component.clipId = right.id;
      component.start -= at;
      component.end -= at;
    } else if (component.end > at) component.end = at;
  });
  selectedClipId = right.id;
  selectedComponentId = components.find((component) => component.clipId === right.id)?.id || null;
  renderAll();
  loadClipPreview(right, Math.min(0.1, clipDuration(right) - 0.01));
  setStatus(`${clip.sceneName} split for editing · scene name unchanged`);
  return right;
}

function splitAtPlayhead() {
  return splitClipAt(currentLocalTime());
}

function deleteSelectedClip() {
  const clip = selectedClip();
  if (!clip) return false;
  const removedIndex = clips.findIndex((candidate) => candidate.id === clip.id);
  const removedComponentIds = new Set(components.filter((component) => component.clipId === clip.id).map((component) => component.id));
  clips.splice(removedIndex, 1);
  components = components.filter((component) => component.clipId !== clip.id);
  removedComponentIds.forEach((id) => executedSceneChanges.delete(id));

  if (!clips.some((candidate) => candidate.mediaId === clip.mediaId)) {
    components.forEach((component) => {
      component.sceneChange?.routes?.forEach((route) => {
        if (route.mediaId === clip.mediaId) route.mediaId = "";
      });
    });
  }

  timelineViewKey = "main";
  const replacement = clips[removedIndex] || clips[removedIndex - 1] || null;
  if (replacement) {
    selectClip(replacement.id);
  } else {
    video.pause();
    pendingPreview = null;
    switchingClip = false;
    selectedClipId = null;
    selectedComponentId = null;
    activeMediaId = null;
    loadedMediaId = null;
    previousPreviewTime = 0;
    video.removeAttribute("src");
    video.load();
    refs.currentTime.textContent = formatTime(0);
    refs.totalTime.textContent = formatTime(0);
    setMediaReady(false);
    renderAll();
  }
  setStatus(`${clip.sceneName} clip deleted · source media kept in Media`);
  return true;
}

function isBranchingComponent(component) {
  return Boolean(component && ["choice", "form"].includes(component.kind));
}

function ensureSceneChange(component) {
  if (!component.sceneChange) component.sceneChange = { enabled: false, executeAt: "end", routes: [] };
  component.sceneChange.executeAt = "end";
  return component.sceneChange;
}

function destinationMedia(component) {
  const sourceMediaId = clips.find((clip) => clip.id === component.clipId)?.mediaId;
  return mediaItems.filter((item) => !item.error && item.id !== sourceMediaId && clips.some((clip) => clip.mediaId === item.id));
}

function binaryMediaRoutes(component) {
  const sceneChange = ensureSceneChange(component);
  const destinations = destinationMedia(component);
  const routes = ["true", "false"].map((condition, index) => {
    const existing = sceneChange.routes.find((route) => route.condition === condition);
    return { condition, mediaId: existing?.mediaId || destinations[index]?.id || "" };
  });
  sceneChange.routes = routes;
  return routes;
}

function validateMediaRoutes(component) {
  if (!component.sceneChange?.enabled) return [];
  const targets = binaryMediaRoutes(component).map((route) => mediaItem(route.mediaId));
  if (targets.some((target) => !target || !clips.some((clip) => clip.mediaId === target.id))) {
    throw new Error(`${component.name} needs timeline media for both Yes and No`);
  }
  return targets;
}

function addComponent(kind, openDialog = true) {
  const clip = selectedClip();
  if (!clip || !mediaReady) {
    const message = "Select a media clip before adding components";
    setStatus(message);
    throw new Error(message);
  }
  const preset = presets[kind];
  const duration = clipDuration(clip);
  const minimumDuration = Math.min(0.2, duration);
  const start = clamp(currentLocalTime(), 0, Math.max(0, duration - minimumDuration));
  const component = {
    id: `component_${++componentCounter}`,
    clipId: clip.id,
    kind,
    name: `${preset.name} ${components.filter((item) => item.kind === kind).length + 1}`,
    html: preset.html,
    css: preset.css,
    start,
    end: Math.min(duration, start + 3),
    sceneChange: ["choice", "form"].includes(kind) ? { enabled: false, executeAt: "end", routes: [] } : null,
    x: preset.x, y: preset.y, width: preset.width, height: preset.height,
  };
  components.push(component);
  selectedComponentId = component.id;
  video.currentTime = clip.sourceStart + Math.min(component.end - 0.01, component.start + 0.01);
  renderAll();
  updateTimeDisplay();
  setStatus(`${component.name} added to ${clip.sceneName}`);
  if (openDialog) openComponentDialog();
  return component;
}

function deleteComponent() {
  const component = selectedComponent();
  if (!component) return;
  components = components.filter((item) => item.id !== component.id);
  selectedComponentId = components.find((item) => item.clipId === selectedClipId)?.id || null;
  if (timelineViewKey.startsWith(`branch:${component.id}:`)) timelineViewKey = "main";
  closeComponentDialog();
  renderAll();
  setStatus(`${component.name} deleted`);
}

function selectComponent(id, seek = true, openDialog = true) {
  const component = components.find((item) => item.id === id);
  if (!component) return;
  const clip = clips.find((item) => item.id === component.clipId);
  selectedClipId = clip.id;
  selectedComponentId = id;
  renderAll();
  if (seek) loadClipPreview(clip, Math.min(component.end - 0.01, component.start + 0.01));
  if (openDialog) openComponentDialog();
}

function openComponentDialog() {
  if (!selectedComponent()) return;
  renderInspector();
  if (!refs.componentDialog.open) refs.componentDialog.showModal();
}

function closeComponentDialog() {
  if (refs.componentDialog.open) refs.componentDialog.close();
}

function renderSceneRouting(component) {
  const supported = isBranchingComponent(component);
  refs.routingSection.hidden = !supported;
  if (!supported) return;
  const sceneChange = ensureSceneChange(component);
  const sourceClip = clips.find((clip) => clip.id === component.clipId);
  refs.changeSceneToggle.checked = sceneChange.enabled;
  refs.routeFields.hidden = !sceneChange.enabled;
  refs.routeSource.textContent = mediaItem(sourceClip?.mediaId)?.name || sourceClip?.sceneName || "Selected media";
  refs.routeList.innerHTML = "";
  if (!sceneChange.enabled) return;
  const destinations = destinationMedia(component);
  const routes = binaryMediaRoutes(component);
  if (!destinations.length) {
    const empty = document.createElement("p");
    empty.className = "route-empty";
    empty.textContent = "Add another media file to the timeline for the Yes and No outcomes.";
    refs.routeList.append(empty);
  }
  routes.forEach((route) => {
    const row = document.createElement("div");
    row.className = "scene-route-row";
    const outcome = document.createElement("div");
    outcome.className = "route-outcome";
    const outcomeName = document.createElement("strong");
    outcomeName.textContent = route.condition === "true" ? "Yes" : "No";
    const outcomeMeaning = document.createElement("span");
    outcomeMeaning.textContent = route.condition === "true" ? "True branch" : "False branch";
    outcome.append(outcomeName, outcomeMeaning);
    const destinationLabel = document.createElement("label");
    destinationLabel.textContent = "Play this media";
    const destination = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = destinations.length ? "Select timeline media" : "Add more media first";
    destination.append(placeholder);
    destinations.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      destination.append(option);
    });
    destination.value = route.mediaId;
    destination.addEventListener("change", () => {
      route.mediaId = destination.value;
      executedSceneChanges.delete(component.id);
      renderTimelineNavigation();
      renderTimeline();
      setStatus(`${component.name} ${route.condition === "true" ? "Yes" : "No"} branch set to ${mediaItem(route.mediaId)?.name || "no media"}`);
    });
    destinationLabel.append(destination);
    row.append(outcome, destinationLabel);
    refs.routeList.append(row);
  });
}

function setComponentMediaRouting(componentId, enabled, routes) {
  const component = components.find((item) => item.id === componentId);
  if (!isBranchingComponent(component)) throw new Error("media branching is only available for choice and form components");
  const normalized = ["true", "false"].map((condition) => {
    const route = routes.find((candidate) => String(candidate?.condition).toLowerCase() === condition);
    const mediaId = String(route?.mediaId || "");
    if (enabled && !destinationMedia(component).some((item) => item.id === mediaId)) {
      throw new Error(`${condition} must target media already on the timeline`);
    }
    return { condition, mediaId };
  });
  component.sceneChange = { enabled: Boolean(enabled), executeAt: "end", routes: normalized };
  renderAll();
  return component;
}

function renderInspector() {
  const component = selectedComponent();
  refs.inspectorFields.hidden = !component;
  if (!component) return;
  refs.dialogTitle.textContent = `Edit ${component.name}`;
  refs.name.value = component.name;
  refs.x.value = Math.round(component.x);
  refs.y.value = Math.round(component.y);
  refs.width.value = Math.round(component.width);
  refs.height.value = Math.round(component.height);
  refs.html.value = component.html;
  refs.css.value = component.css;
  renderSceneRouting(component);
}

function updateComponentFromInspector() {
  const component = selectedComponent();
  if (!component) return;
  component.name = refs.name.value;
  component.x = clamp(Number(refs.x.value), 0, 95);
  component.y = clamp(Number(refs.y.value), 0, 95);
  component.width = clamp(Number(refs.width.value), 5, 100 - component.x);
  component.height = clamp(Number(refs.height.value), 5, 100 - component.y);
  component.html = refs.html.value;
  component.css = refs.css.value;
  refs.dialogTitle.textContent = `Edit ${component.name}`;
  renderTimelineNavigation();
  renderTimeline();
  renderOverlays();
}

function renderTimeline() {
  const layouts = clipLayouts();
  const duration = layouts.at(-1)?.end || 1;
  clipTrack.innerHTML = "";
  ruler.innerHTML = "";
  if (!layouts.length) {
    const empty = document.createElement("span");
    empty.className = "empty-clip-message";
    empty.textContent = timelineViewKey === "main" ? "Add media to build the timeline" : "This branch has no media";
    clipTrack.append(empty);
    renderComponentTimeline(layouts, duration);
    return;
  }
  layouts.forEach(({ clip, duration: durationForClip }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `clip${clip.id === selectedClipId ? " active" : ""}`;
    button.style.flex = String(Math.max(0.1, durationForClip));
    const scene = document.createElement("strong");
    scene.textContent = clip.sceneName;
    const details = document.createElement("span");
    details.textContent = `${mediaItem(clip.mediaId)?.name || "Missing media"} · ${formatTime(clip.sourceStart)}–${formatTime(clip.sourceEnd)}`;
    button.append(scene, details);
    button.addEventListener("click", (event) => { event.stopPropagation(); selectClip(clip.id); });
    clipTrack.append(button);
  });
  for (let index = 0; index <= 5; index += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${index / 5 * 100}%`;
    tick.textContent = formatTime(duration * index / 5);
    ruler.append(tick);
  }
  renderComponentTimeline(layouts, duration);
}

function renderComponentTimeline(layouts, duration) {
  componentLayers.innerHTML = "";
  const visibleIds = new Set(layouts.map((layout) => layout.clip.id));
  const visibleComponents = components.filter((component) => visibleIds.has(component.clipId));
  if (!visibleComponents.length) {
    const row = document.createElement("div");
    row.className = "layer-row empty-layer-row";
    row.innerHTML = `<div class="layer-label"><strong>UI</strong><span>No layers yet</span></div><div class="component-lane"><span class="empty-layer-message">${layouts.length ? "Add a component to create a layer" : "Add media to start"}</span></div>`;
    const lane = row.querySelector(".component-lane");
    lane.addEventListener("click", (event) => seekFromTimeline(event, lane));
    componentLayers.append(row);
    return;
  }
  visibleComponents.forEach((component, index) => {
    const layout = layouts.find((candidate) => candidate.clip.id === component.clipId);
    const row = document.createElement("div");
    row.className = `layer-row component-layer-row${component.id === selectedComponentId ? " active" : ""}`;
    const layerLabel = document.createElement("button");
    layerLabel.type = "button";
    layerLabel.className = "layer-label component-layer-label";
    const layerName = document.createElement("strong");
    layerName.textContent = component.name;
    const layerType = document.createElement("span");
    layerType.textContent = `${component.kind} · layer ${index + 1}${component.sceneChange?.enabled ? " · branches" : ""}`;
    layerLabel.append(layerName, layerType);
    layerLabel.addEventListener("click", () => selectComponent(component.id));
    const lane = document.createElement("div");
    lane.className = "component-lane";
    lane.addEventListener("click", (event) => seekFromTimeline(event, lane));
    const bar = document.createElement("div");
    bar.className = `component-bar${component.id === selectedComponentId ? " active" : ""}`;
    bar.dataset.componentId = component.id;
    bar.style.left = `${(layout.start + component.start) / duration * 100}%`;
    bar.style.width = `${Math.max(0.35, (component.end - component.start) / duration * 100)}%`;
    bar.innerHTML = '<span class="resize-handle start" data-resize="start"></span><span class="component-bar-label"></span><span class="resize-handle end" data-resize="end"></span>';
    updateTimingBarLabel(bar, component);
    bar.addEventListener("click", (event) => { event.stopPropagation(); selectComponent(component.id); });
    bar.addEventListener("pointerdown", (event) => startTimingDrag(event, component, bar, lane, event.target.dataset.resize || "move", duration));
    lane.append(bar);
    row.append(layerLabel, lane);
    componentLayers.append(row);
  });
}

function updateTimingBarLabel(bar, component) {
  const label = bar.querySelector(".component-bar-label");
  if (label) label.textContent = `${component.name} · ${(component.end - component.start).toFixed(1)}s${component.sceneChange?.enabled ? " · branch at end" : ""}`;
}

function startTimingDrag(event, component, bar, lane, mode, timelineDuration) {
  event.preventDefault();
  event.stopPropagation();
  const clip = clips.find((item) => item.id === component.clipId);
  const layout = clipLayouts().find((item) => item.clip.id === clip.id);
  if (!clip || !layout) return;
  selectedClipId = clip.id;
  selectedComponentId = component.id;
  const pointerStart = event.clientX;
  const original = { start: component.start, end: component.end };
  const trackWidth = lane.getBoundingClientRect().width || 1;
  const minimumDuration = Math.min(0.2, clipDuration(clip));
  bar.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const delta = (moveEvent.clientX - pointerStart) / trackWidth * timelineDuration;
    if (mode === "start") component.start = clamp(original.start + delta, 0, component.end - minimumDuration);
    else if (mode === "end") component.end = clamp(original.end + delta, component.start + minimumDuration, clipDuration(clip));
    else {
      const componentDuration = original.end - original.start;
      component.start = clamp(original.start + delta, 0, clipDuration(clip) - componentDuration);
      component.end = component.start + componentDuration;
    }
    bar.style.left = `${(layout.start + component.start) / timelineDuration * 100}%`;
    bar.style.width = `${Math.max(0.35, (component.end - component.start) / timelineDuration * 100)}%`;
    updateTimingBarLabel(bar, component);
  };
  const stop = () => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", stop);
    bar.removeEventListener("pointercancel", stop);
    loadClipPreview(clip, Math.min(component.end - 0.01, component.start + 0.01));
    renderAll();
    setStatus(`${component.name} visible from ${formatTime(component.start)} to ${formatTime(component.end)} in this clip`);
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", stop);
  bar.addEventListener("pointercancel", stop);
}

function positionCanvasFrame() {
  const areaWidth = Math.max(1, videoArea.clientWidth - 32);
  const areaHeight = Math.max(1, videoArea.clientHeight - 32);
  const ratio = canvasRatios[canvasRatio];
  const scale = Math.min(areaWidth / ratio.width, areaHeight / ratio.height);
  canvasFrame.style.width = `${ratio.width * scale}px`;
  canvasFrame.style.height = `${ratio.height * scale}px`;
}

function renderOverlays() {
  positionCanvasFrame();
  overlayLayer.innerHTML = "";
  const clip = selectedClip();
  if (!clip) return;
  const time = currentLocalTime();
  components.filter((component) => component.clipId === clip.id && time >= component.start - 0.03 && time < component.end).forEach((component) => {
    const wrapper = document.createElement("div");
    wrapper.className = `overlay-component${isBranchingComponent(component) ? " interactive" : ""}${component.id === selectedComponentId ? " selected" : ""}`;
    wrapper.dataset.label = component.name;
    Object.assign(wrapper.style, { left: `${component.x}%`, top: `${component.y}%`, width: `${component.width}%`, height: `${component.height}%` });
    const preview = document.createElement("editor-overlay");
    preview.update(component);
    preview.addEventListener("pvo-answer", (event) => {
      component.pendingAnswer = event.detail.answer;
      executedSceneChanges.delete(component.id);
      const outcome = component.pendingAnswer === true ? "Yes" : component.pendingAnswer === false ? "No" : String(component.pendingAnswer);
      setStatus(`${component.name}: ${outcome} selected · branch runs at ${formatTime(component.end)}`);
    });
    wrapper.append(preview);
    wrapper.addEventListener("pointerdown", (event) => startOverlayDrag(event, component, wrapper));
    wrapper.addEventListener("click", (event) => {
      event.stopPropagation();
      const usedControl = event.composedPath().some((node) => node instanceof Element && node.matches("input, button, select, textarea, label"));
      if (!usedControl) selectComponent(component.id, false);
    });
    overlayLayer.append(wrapper);
  });
}

function startOverlayDrag(event, component, element) {
  const usedControl = event.composedPath().some((node) => node instanceof Element && node.matches("input, button, select, textarea, label"));
  if (usedControl) return;
  event.preventDefault();
  selectedComponentId = component.id;
  const start = { clientX: event.clientX, clientY: event.clientY, x: component.x, y: component.y };
  element.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    component.x = clamp(start.x + (moveEvent.clientX - start.clientX) / overlayLayer.clientWidth * 100, 0, 100 - component.width);
    component.y = clamp(start.y + (moveEvent.clientY - start.clientY) / overlayLayer.clientHeight * 100, 0, 100 - component.height);
    element.style.left = `${component.x}%`;
    element.style.top = `${component.y}%`;
    refs.x.value = Math.round(component.x);
    refs.y.value = Math.round(component.y);
  };
  const stop = () => {
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", stop);
    element.removeEventListener("pointercancel", stop);
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
}

function renderAll() {
  renderTimelineNavigation();
  renderTimeline();
  renderInspector();
  renderOverlays();
  renderMediaLibrary();
  const clip = selectedClip();
  refs.sceneName.value = clip?.sceneName || "No scene";
  refs.deleteClipButton.disabled = !clip;
  refs.projectDuration.textContent = formatTime(projectDuration());
  renderExportState();
}

function setCanvasRatio(value) {
  if (!Object.hasOwn(canvasRatios, value)) throw new Error("ratio must be 16:9, 9:16, 1:1, or 4:5");
  canvasRatio = value;
  refs.canvasRatio.value = value;
  canvasFrame.dataset.ratio = value;
  renderOverlays();
  setStatus(`Canvas changed to ${value}`);
  return canvasRatios[value];
}

function executeBranchAtLayerEnd(localTime) {
  components.filter((component) => component.clipId === selectedClipId).forEach((component) => {
    const entered = previousPreviewTime < component.start && localTime >= component.start;
    const rewound = previousPreviewTime >= component.start && localTime < component.start;
    if (entered || rewound) {
      delete component.pendingAnswer;
      executedSceneChanges.delete(component.id);
    } else if (localTime < component.end - 0.05) executedSceneChanges.delete(component.id);
  });
  const component = components.find((item) => (
    item.clipId === selectedClipId
    && item.sceneChange?.enabled
    && item.pendingAnswer !== undefined
    && !executedSceneChanges.has(item.id)
    && previousPreviewTime < item.end
    && localTime >= item.end
  ));
  previousPreviewTime = localTime;
  if (!component) return false;
  let targets;
  try { targets = validateMediaRoutes(component); }
  catch (error) { setStatus(error.message); return false; }
  const condition = component.pendingAnswer === true ? "true" : "false";
  const target = component.pendingAnswer === true ? targets[0] : targets[1];
  const targetClip = clips.find((clip) => clip.mediaId === target.id);
  if (!targetClip) return false;
  const autoplay = !video.paused;
  executedSceneChanges.add(component.id);
  timelineViewKey = `branch:${component.id}:${condition}`;
  selectedClipId = targetClip.id;
  selectedComponentId = components.find((item) => item.clipId === targetClip.id)?.id || null;
  renderAll();
  loadClipPreview(targetClip, 0, autoplay);
  setStatus(`${component.name}: ${condition === "true" ? "Yes" : "No"} · playing ${target.name}`);
  return true;
}

function advanceAtClipEnd(localTime, force = false) {
  const clip = selectedClip();
  if (!clip || (!force && video.paused) || switchingClip || localTime < clipDuration(clip) - 0.04) return false;
  const layouts = clipLayouts();
  const index = layouts.findIndex((layout) => layout.clip.id === clip.id);
  const next = layouts[index + 1]?.clip;
  if (!next) {
    video.pause();
    return false;
  }
  switchingClip = true;
  selectClip(next.id, true, true);
  return true;
}

function updateTimeDisplay() {
  const clip = selectedClip();
  if (!clip || loadedMediaId !== clip.mediaId) return;
  if (video.currentTime < clip.sourceStart - 0.03) video.currentTime = clip.sourceStart;
  const localTime = currentLocalTime();
  if (executeBranchAtLayerEnd(localTime)) return;
  if (advanceAtClipEnd(localTime)) return;
  const duration = viewDuration();
  const time = timelineTime();
  refs.currentTime.textContent = formatTime(time);
  refs.totalTime.textContent = formatTime(duration);
  const percentage = duration ? time / duration * 100 : 0;
  refs.playhead.style.left = `${clamp(percentage, 0, 100)}%`;
  timelineEditor.style.setProperty("--playhead-position", `${clamp(percentage, 0, 100)}%`);
  renderOverlays();
}

function seekTimelineTime(time) {
  const layouts = clipLayouts();
  const target = layouts.find((layout, index) => time >= layout.start && (time < layout.end || index === layouts.length - 1 && time <= layout.end));
  if (!target) return;
  const local = clamp(time - target.start, 0, Math.max(0, target.duration - 0.01));
  selectedClipId = target.clip.id;
  selectedComponentId = components.find((component) => component.clipId === target.clip.id)?.id || null;
  loadClipPreview(target.clip, local);
}

function seekFromTimeline(event, lane) {
  const bounds = lane.getBoundingClientRect();
  const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  seekTimelineTime(ratio * viewDuration());
}

function componentMarkup(component) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(component.html);
  return template.content;
}

function componentText(component) {
  return componentMarkup(component).textContent.replace(/\s+/g, " ").trim() || component.name;
}

function answerStateKey(component) {
  return `answers.${component.id}`;
}

function exportChoiceOptions(component) {
  const radios = [...componentMarkup(component).querySelectorAll('input[type="radio"]')].slice(0, 4);
  let options = radios.map((radio, index) => ({
    label: radio.closest("label")?.textContent.replace(/\s+/g, " ").trim() || `Option ${index + 1}`,
    value: index === 0,
  }));
  if (options.length < 2) options = [{ label: "Yes", value: true }, { label: "No", value: false }];
  return options.map((option) => ({ ...option, actions: [{ type: "set", key: answerStateKey(component), value: option.value }] }));
}

function exportFormFields(component) {
  const used = new Set();
  return [...componentMarkup(component).querySelectorAll("input, select, textarea")].map((field, index) => {
    let name = String(field.getAttribute("name") || `field_${index + 1}`).replace(/[^a-z0-9_-]+/gi, "_") || `field_${index + 1}`;
    while (used.has(name)) name = `${name}_${index + 1}`;
    used.add(name);
    const rawType = field.tagName === "SELECT" ? "choice" : field.getAttribute("type");
    return {
      name,
      label: field.getAttribute("aria-label") || field.getAttribute("placeholder") || name.replaceAll("_", " "),
      type: ["number", "email", "choice"].includes(rawType) ? rawType : "text",
      required: field.required,
    };
  });
}

function exportedComponent(component) {
  const clip = clips.find((item) => item.id === component.clipId);
  const exported = {
    id: component.id,
    kind: component.kind,
    title: component.name,
    html: sanitizeHtml(component.html),
    css: sanitizeCss(component.css),
    presentation: {
      scene: clip.sceneId,
      start: clip.sourceStart + component.start,
      end: clip.sourceStart + component.end,
      x: component.x / 100, y: component.y / 100,
      width: component.width / 100, height: component.height / 100,
    },
  };
  if (component.kind === "tooltip" || component.kind === "card") exported.text = componentText(component);
  if (component.kind === "choice") {
    exported.text = componentMarkup(component).querySelector("legend")?.textContent.trim() || component.name;
    exported.options = exportChoiceOptions(component);
  }
  if (component.kind === "form") {
    exported.fields = exportFormFields(component);
    exported.on_submit = [{ type: "custom", name: "submit_form", payload: { component: component.id }, into: answerStateKey(component) }];
  }
  return exported;
}

function buildPvoManifest() {
  if (!canExportTimeline()) throw new Error("Combined multi-media export needs the renderer step");
  const item = mediaItem(clips[0].mediaId);
  const title = sceneLabelFromFile(item.name);
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "pvo_video";
  const scenesById = new Map();
  clips.forEach((clip) => {
    const existing = scenesById.get(clip.sceneId);
    if (existing) {
      existing.start = Math.min(existing.start, clip.sourceStart);
      existing.end = Math.max(existing.end, clip.sourceEnd);
    } else scenesById.set(clip.sceneId, { id: clip.sceneId, label: clip.sceneName, start: clip.sourceStart, end: clip.sourceEnd });
  });
  const triggers = components.flatMap((component) => {
    const clip = clips.find((item) => item.id === component.clipId);
    return [{
      id: `${component.id}_show`, scene: clip.sceneId, at: clip.sourceStart + component.start,
      actions: [{ type: "show", component: component.id }],
    }, {
      id: `${component.id}_hide`, scene: clip.sceneId, at: clip.sourceStart + component.end,
      actions: [{ type: "hide", component: component.id }],
    }];
  });
  const ratio = canvasRatios[canvasRatio];
  return {
    spec_version: PVO_SPEC_VERSION,
    id,
    title,
    initial_scene: clips[0].sceneId,
    canvas: { ratio: canvasRatio, width: ratio.width, height: ratio.height },
    state: { initial: {} },
    scenes: [...scenesById.values()],
    components: components.map(exportedComponent),
    hotspots: [],
    triggers,
  };
}

async function exportPvoVideo() {
  if (!canExportTimeline() || exporting) return;
  const item = mediaItem(clips[0].mediaId);
  exporting = true;
  renderExportState();
  refs.exportPvoButton.textContent = "Exporting…";
  setStatus("Packing PVO video…");
  try {
    const output = await packPvo(item.file, buildPvoManifest());
    const name = `${sceneLabelFromFile(item.name)}.pvo.${mediaItemIsMov(item) ? "mov" : "mp4"}`;
    const url = URL.createObjectURL(output);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus(`${name} exported`);
  } catch (error) {
    setStatus(`Export failed · ${error.message}`);
  } finally {
    exporting = false;
    refs.exportPvoButton.textContent = "Export PVO video";
    renderExportState();
  }
}

function setComponentTiming(componentId, start, end) {
  const component = components.find((item) => item.id === componentId);
  const clip = clips.find((item) => item.id === component?.clipId);
  if (!component || !clip) throw new Error("component does not exist");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.2) throw new Error("component timing needs at least 0.2 seconds");
  if (start < 0 || end > clipDuration(clip)) throw new Error("component timing must stay inside its media clip");
  component.start = start;
  component.end = end;
  selectComponent(component.id, true, false);
  return component;
}

video.addEventListener("loadedmetadata", () => {
  if (!pendingPreview || pendingPreview.mediaId !== activeMediaId) return;
  const pending = pendingPreview;
  pendingPreview = null;
  loadedMediaId = pending.mediaId;
  video.currentTime = pending.sourceTime;
  switchingClip = false;
  setMediaReady(true);
  renderAll();
  updateTimeDisplay();
  if (pending.autoplay) void video.play().catch(() => {});
});

video.addEventListener("error", () => {
  const item = activeMediaItem();
  if (item) item.error = true;
  pendingPreview = null;
  switchingClip = false;
  loadedMediaId = null;
  setMediaReady(false, { title: "Could not open this video", message: "This MP4 or MOV uses a codec the browser cannot preview." });
  setStatus(`${item?.name || "Video"} could not be opened`);
});

video.addEventListener("timeupdate", updateTimeDisplay);
video.addEventListener("seeked", updateTimeDisplay);
video.addEventListener("ended", () => {
  const localTime = clipDuration(selectedClip());
  if (!executeBranchAtLayerEnd(localTime)) advanceAtClipEnd(localTime, true);
});
window.addEventListener("resize", positionCanvasFrame);
window.addEventListener("beforeunload", () => mediaItems.forEach((item) => URL.revokeObjectURL(item.url)));
new ResizeObserver(positionCanvasFrame).observe(videoArea);

addComponentButtons.forEach((button) => button.addEventListener("click", () => addComponent(button.dataset.addComponent)));
refs.splitButton.addEventListener("click", () => { try { splitAtPlayhead(); } catch { /* status already explains it */ } });
refs.deleteClipButton.addEventListener("click", deleteSelectedClip);
refs.sceneName.addEventListener("change", () => renameSelectedScene(refs.sceneName.value));
refs.videoInput.addEventListener("change", (event) => {
  void importMediaFiles([...event.target.files]);
  event.target.value = "";
});
refs.exportPvoButton.addEventListener("click", exportPvoVideo);
refs.canvasRatio.addEventListener("change", () => setCanvasRatio(refs.canvasRatio.value));
refs.timelineView.addEventListener("change", () => setTimelineView(refs.timelineView.value));
refs.mainTimelineButton.addEventListener("click", () => setTimelineView("main"));
refs.mediaTab.addEventListener("click", () => setPanelTab("media"));
refs.componentsTab.addEventListener("click", () => setPanelTab("components"));
[refs.mediaTab, refs.componentsTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const next = tab === refs.mediaTab ? refs.componentsTab : refs.mediaTab;
  setPanelTab(next === refs.mediaTab ? "media" : "components");
  next.focus();
}));
$("#deleteComponentButton").addEventListener("click", deleteComponent);
$("#closeComponentDialog").addEventListener("click", closeComponentDialog);
$("#doneComponentDialog").addEventListener("click", closeComponentDialog);
refs.componentDialog.addEventListener("click", (event) => { if (event.target === refs.componentDialog) closeComponentDialog(); });
refs.changeSceneToggle.addEventListener("change", () => {
  const component = selectedComponent();
  if (!isBranchingComponent(component)) return;
  const sceneChange = ensureSceneChange(component);
  sceneChange.enabled = refs.changeSceneToggle.checked;
  if (sceneChange.enabled) binaryMediaRoutes(component);
  executedSceneChanges.delete(component.id);
  renderSceneRouting(component);
  renderTimelineNavigation();
  renderTimeline();
  setStatus(`${component.name} media branch ${sceneChange.enabled ? "enabled" : "disabled"}`);
});
[refs.name, refs.x, refs.y, refs.width, refs.height, refs.html, refs.css].forEach((input) => input.addEventListener("input", updateComponentFromInspector));
trackWrap.addEventListener("click", (event) => seekFromTimeline(event, trackWrap));
ruler.addEventListener("click", (event) => seekFromTimeline(event, ruler));
document.addEventListener("keydown", (event) => {
  if (!["Delete", "Backspace"].includes(event.key) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (refs.componentDialog.open || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
  if (!selectedClip()) return;
  event.preventDefault();
  deleteSelectedClip();
});

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) => {
    try { void Promise.resolve(context.registerTool(tool)).catch((error) => console.warn("WebMCP registration failed", error)); }
    catch (error) { console.warn("WebMCP registration failed", error); }
  };
  register({
    name: "read_editor_state",
    title: "Read editor state",
    description: "Read the imported media, shared timeline clips, branch view, and UI component layers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return {
        activeView: timelineViewKey,
        activeMedia: activeMediaId,
        selectedClip: selectedClipId,
        selectedComponent: selectedComponentId,
        canvasRatio,
        media: mediaItems.map((item) => ({ id: item.id, name: item.name, duration: item.duration, error: item.error })),
        clips: structuredClone(clips),
        components: structuredClone(components),
      };
    },
  });
  register({
    name: "set_canvas_ratio",
    title: "Set canvas ratio",
    description: "Set the editor canvas ratio.",
    inputSchema: { type: "object", properties: { ratio: { enum: ["16:9", "9:16", "1:1", "4:5"] } }, required: ["ratio"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) { const ratio = setCanvasRatio(input?.ratio); return { ratio: canvasRatio, ...ratio }; },
  });
  register({
    name: "split_timeline_clip",
    title: "Split timeline clip",
    description: "Split the selected media clip at a local time without creating a new scene.",
    inputSchema: { type: "object", properties: { time: { type: "number", minimum: 0 } }, required: ["time"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) { const clip = splitClipAt(input?.time); return { clip: clip.id, scene: clip.sceneId, sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd }; },
  });
  register({
    name: "add_editor_component",
    title: "Add editor component",
    description: "Add a tooltip, card, choice, or form to the selected media clip.",
    inputSchema: { type: "object", properties: { kind: { enum: ["tooltip", "card", "choice", "form"] } }, required: ["kind"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) { const component = addComponent(input?.kind, false); return { component: component.id, clip: component.clipId, start: component.start, end: component.end }; },
  });
  register({
    name: "set_component_timing",
    title: "Set component timing",
    description: "Set a component's local start and end time inside its media clip.",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } }, required: ["componentId", "start", "end"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) { const component = setComponentTiming(input?.componentId, input?.start, input?.end); return { component: component.id, clip: component.clipId, start: component.start, end: component.end }; },
  });
  register({
    name: "set_component_media_routing",
    title: "Set component media routing",
    description: "Map a choice or form's Yes and No outcomes to media items already on the timeline.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string" }, enabled: { type: "boolean" },
        routes: { type: "array", items: { type: "object", properties: { condition: { enum: ["true", "false"] }, mediaId: { type: "string" } }, required: ["condition", "mediaId"], additionalProperties: false } },
      },
      required: ["componentId", "enabled", "routes"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) { const component = setComponentMediaRouting(input?.componentId, input?.enabled, input?.routes || []); return { component: component.id, mediaBranch: structuredClone(component.sceneChange) }; },
  });
}

setPanelTab("media");
setMediaReady(false);
renderAll();
registerWebMcpTools();
