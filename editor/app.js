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
  changeSceneToggle: $("#changeSceneToggle"),
  canvasRatio: $("#canvasRatio"),
  mediaStart: $("#mediaStart"), mediaStartTitle: $("#mediaStartTitle"),
  mediaStartMessage: $("#mediaStartMessage"), chooseVideoButton: $("#chooseVideoButton"),
  splitButton: $("#splitButton"),
  mediaTab: $("#mediaTab"), componentsTab: $("#componentsTab"),
  mediaPanel: $("#mediaPanel"), componentsPanel: $("#componentsPanel"),
  mediaFileName: $("#mediaFileName"), mediaFileMeta: $("#mediaFileMeta"),
  replaceMediaButton: $("#replaceMediaButton"), exportPvoButton: $("#exportPvoButton"),
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
    html: '<div class="choice"><h3>Choose a path</h3><div><button>Option one</button><button>Option two</button></div></div>',
    css: `.choice {
  padding: 16px;
  border-radius: 10px;
  background: rgba(17,24,39,.94);
  color: white;
  font-family: Arial, sans-serif;
}
.choice h3 { margin: 0 0 12px; font-size: 18px; }
.choice div { display: flex; gap: 8px; }
.choice button { flex: 1; padding: 9px; border: 0; border-radius: 6px; background: #72a7ff; color: #081226; font-weight: 700; }`,
    x: 25, y: 60, width: 50, height: 28,
  },
  form: {
    name: "Form",
    html: '<form class="form"><label>Name<input placeholder="Your name"></label><button type="button">Submit</button></form>',
    css: `.form {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 10px;
  background: rgba(255,255,255,.96);
  color: #171717;
  font: 600 13px Arial, sans-serif;
}
.form label { display: grid; gap: 5px; }
.form input { padding: 8px; border: 1px solid #bbb; border-radius: 5px; }
.form button { padding: 9px; border: 0; border-radius: 5px; background: #171717; color: white; }`,
    x: 60, y: 50, width: 32, height: 35,
  },
};

let clips = [];
let components = [];
let selectedClipId = null;
let selectedComponentId = null;
let componentCounter = 0;
let clipCounter = 0;
let objectUrl = null;
let ignoreSceneSyncUntil = 0;
let pausedAtComponentId = null;
let canvasRatio = "16:9";
let sourceMedia = null;
let sourceMediaName = "";
let mediaReady = false;
let exporting = false;

class EditorOverlay extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  update(component) {
    const safeHtml = sanitizeHtml(component.html);
    const safeCss = sanitizeCss(component.css);
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; width:100%; height:100%; }
      * { box-sizing:border-box; }
      .component-root { width:100%; height:100%; }
      ${safeCss}
    </style><div class="component-root">${safeHtml}</div>`;
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

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

function setStatus(message) {
  refs.status.textContent = message;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderMediaDetails() {
  if (!sourceMedia) {
    refs.mediaFileName.textContent = "No video";
    refs.mediaFileMeta.textContent = "Choose an MP4 to begin.";
    return;
  }
  refs.mediaFileName.textContent = sourceMediaName;
  const details = [formatFileSize(sourceMedia.size)];
  details.push(mediaReady ? formatTime(video.duration) : "Loading…");
  if (mediaReady) details.push(canvasRatio);
  refs.mediaFileMeta.textContent = details.join(" · ");
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

function setMediaReady(ready, copy = {}) {
  mediaReady = ready;
  refs.mediaStart.hidden = ready;
  canvasFrame.hidden = !ready;
  refs.canvasRatio.disabled = !ready;
  refs.splitButton.disabled = !ready;
  refs.exportPvoButton.disabled = !ready || !sourceMedia || exporting;
  refs.playhead.hidden = !ready;
  timelineEditor.classList.toggle("is-empty", !ready);
  addComponentButtons.forEach((button) => { button.disabled = !ready; });
  if (!ready) {
    refs.mediaStartTitle.textContent = copy.title || "Open a video to start";
    refs.mediaStartMessage.textContent = copy.message || "Choose an MP4 from your computer.";
  }
  renderMediaDetails();
}

function selectedClip() {
  return clips.find((clip) => clip.id === selectedClipId) || clips[0];
}

function selectedComponent() {
  return components.find((component) => component.id === selectedComponentId) || null;
}

function sceneAt(time) {
  return clips.find((clip, index) => time >= clip.start && (time < clip.end || index === clips.length - 1 && time <= clip.end));
}

function normalizeSceneNames() {
  clips.forEach((clip, index) => { clip.name = `Scene ${index + 1}`; });
}

function selectClip(id, seek = true) {
  selectedClipId = id;
  const clip = selectedClip();
  if (!clip) return;
  const firstComponent = components.find((component) => component.clipId === id);
  selectedComponentId = firstComponent?.id || null;
  if (seek) video.currentTime = clip.start + 0.01;
  renderAll();
  if (seek) updateTime();
}

function selectComponent(id, seek = true, openDialog = true) {
  const component = components.find((item) => item.id === id);
  if (!component) return;
  selectedClipId = component.clipId;
  selectedComponentId = id;
  if (seek) {
    ignoreSceneSyncUntil = performance.now() + 500;
    video.currentTime = Math.min(component.end - 0.01, component.start + 0.01);
  }
  renderAll();
  if (seek) updateTime();
  if (openDialog) openComponentDialog();
}

function splitAtPlayhead() {
  splitSceneAt(Number(video.currentTime));
}

function splitSceneAt(at) {
  const index = clips.findIndex((clip) => at > clip.start + 0.08 && at < clip.end - 0.08);
  if (index < 0) {
    const message = "Split time must be inside a scene and away from its edges";
    setStatus(message);
    throw new Error(message);
  }
  const current = clips[index];
  const right = { id: `scene_${++clipCounter}`, name: "", start: at, end: current.end };
  current.end = at;
  clips.splice(index + 1, 0, right);
  components.filter((component) => component.clipId === current.id).forEach((component) => {
    if (component.start >= at) {
      component.clipId = right.id;
      component.start = Math.max(component.start, at);
    } else if (component.end > at) {
      component.end = at;
    }
  });
  normalizeSceneNames();
  selectedClipId = right.id;
  selectedComponentId = null;
  ignoreSceneSyncUntil = performance.now() + 750;
  video.currentTime = Math.min(right.end, at + 0.1);
  renderAll();
  updateTime();
  setStatus(`Split at ${formatTime(at)} · ${clips.length} scenes`);
  return right;
}

function addComponent(kind, openDialog = true) {
  const clip = selectedClip();
  if (!clip) {
    const message = "Open a video before adding components";
    setStatus(message);
    throw new Error(message);
  }
  const preset = presets[kind];
  const minimumDuration = Math.min(0.2, clip.end - clip.start);
  const requestedStart = video.currentTime >= clip.start && video.currentTime < clip.end ? video.currentTime : clip.start;
  const start = clamp(requestedStart, clip.start, Math.max(clip.start, clip.end - minimumDuration));
  const end = Math.min(clip.end, start + 3);
  componentCounter += 1;
  const component = {
    id: `component_${componentCounter}`,
    clipId: clip.id,
    kind,
    name: `${preset.name} ${components.filter((item) => item.kind === kind).length + 1}`,
    html: preset.html,
    css: preset.css,
    start,
    end,
    sceneChange: ["choice", "form"].includes(kind) ? { enabled: false, pauseAtStart: true, routes: [] } : null,
    x: preset.x, y: preset.y, width: preset.width, height: preset.height,
  };
  components.push(component);
  selectedComponentId = component.id;
  ignoreSceneSyncUntil = performance.now() + 500;
  video.currentTime = Math.min(component.end - 0.01, component.start + 0.01);
  renderAll();
  updateTime();
  setStatus(`${preset.name} added for ${formatTime(component.end - component.start)} in ${clip.name}`);
  if (openDialog) openComponentDialog();
  return component;
}

function deleteComponent() {
  const component = selectedComponent();
  if (!component) return;
  components = components.filter((item) => item.id !== component.id);
  selectedComponentId = components.find((item) => item.clipId === selectedClipId)?.id || null;
  closeComponentDialog();
  renderAll();
  setStatus(`${component.name} deleted`);
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
  renderTimeline();
  renderOverlays();
}

function openComponentDialog() {
  if (!selectedComponent()) return;
  renderInspector();
  if (!refs.componentDialog.open) refs.componentDialog.showModal();
}

function closeComponentDialog() {
  if (refs.componentDialog.open) refs.componentDialog.close();
}

function isSceneChangingComponent(component) {
  return Boolean(component && ["choice", "form"].includes(component.kind));
}

function ensureSceneChange(component) {
  if (!component.sceneChange) component.sceneChange = { enabled: false, pauseAtStart: true, routes: [] };
  return component.sceneChange;
}

function renderSceneRouting(component) {
  const supported = isSceneChangingComponent(component);
  refs.routingSection.hidden = !supported;
  if (!supported) return;

  const sceneChange = ensureSceneChange(component);
  const source = clips.find((clip) => clip.id === component.clipId);
  refs.changeSceneToggle.checked = sceneChange.enabled;
  refs.routeFields.hidden = !sceneChange.enabled;
  refs.routeSource.textContent = source?.name || "Unknown scene";
  refs.routeList.innerHTML = "";
  if (!sceneChange.enabled) return;

  const destinations = clips.filter((clip) => clip.id !== component.clipId);
  if (sceneChange.routes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "route-empty";
    empty.textContent = destinations.length ? "Add a condition and choose its destination scene." : "Split the video to create another scene, then add a condition.";
    refs.routeList.append(empty);
  }

  sceneChange.routes.forEach((route, index) => {
    const row = document.createElement("div");
    row.className = "scene-route-row";

    const conditionLabel = document.createElement("label");
    conditionLabel.textContent = "Condition / result";
    const condition = document.createElement("input");
    condition.type = "text";
    condition.placeholder = component.kind === "choice" ? "option_one" : "success";
    condition.value = route.condition;
    condition.addEventListener("input", () => { route.condition = condition.value; });
    conditionLabel.append(condition);

    const destinationLabel = document.createElement("label");
    destinationLabel.textContent = "Go to scene";
    const destination = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = destinations.length ? "Select scene" : "Create another scene first";
    destination.append(placeholder);
    destinations.forEach((clip) => {
      const option = document.createElement("option");
      option.value = clip.id;
      option.textContent = `${clip.name} · ${formatTime(clip.start)}`;
      destination.append(option);
    });
    destination.value = route.sceneId;
    destination.addEventListener("change", () => { route.sceneId = destination.value; });
    destinationLabel.append(destination);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-route-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove condition ${index + 1}`);
    remove.addEventListener("click", () => {
      sceneChange.routes.splice(index, 1);
      renderSceneRouting(component);
    });

    row.append(conditionLabel, destinationLabel, remove);
    refs.routeList.append(row);
  });
}

function addSceneRoute() {
  const component = selectedComponent();
  if (!isSceneChangingComponent(component)) return;
  const sceneChange = ensureSceneChange(component);
  const firstDestination = clips.find((clip) => clip.id !== component.clipId);
  sceneChange.routes.push({ condition: "", sceneId: firstDestination?.id || "" });
  renderSceneRouting(component);
  setStatus(`Condition added to ${component.name}`);
}

function setComponentSceneRouting(componentId, enabled, routes) {
  const component = components.find((item) => item.id === componentId);
  if (!component) throw new Error("component does not exist");
  if (!isSceneChangingComponent(component)) throw new Error("scene routing is only available for choice and form components");
  if (!Array.isArray(routes)) throw new Error("routes must be an array");

  const normalized = routes.map((route) => {
    const condition = String(route?.condition || "").trim();
    const sceneId = String(route?.sceneId || "");
    const destination = clips.find((clip) => clip.id === sceneId);
    if (!condition) throw new Error("every route needs a condition or result");
    if (!destination || destination.id === component.clipId) throw new Error("every route must target a different existing scene");
    return { condition, sceneId };
  });
  if (enabled && normalized.length === 0) throw new Error("enabled scene routing needs at least one condition");

  component.sceneChange = { enabled: Boolean(enabled), pauseAtStart: true, routes: normalized };
  selectedClipId = component.clipId;
  selectedComponentId = component.id;
  renderAll();
  setStatus(`${component.name} scene routing ${enabled ? "enabled" : "disabled"}`);
  return component;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function renderAll() {
  normalizeSceneNames();
  renderTimeline();
  renderInspector();
  renderOverlays();
  const clip = selectedClip();
  refs.sceneName.textContent = clip?.name || "No scene";
}

function renderTimeline() {
  clipTrack.innerHTML = "";
  ruler.innerHTML = "";
  if (clips.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-clip-message";
    empty.textContent = "Open a video to create scenes";
    clipTrack.append(empty);
    renderComponentTimeline(1);
    return;
  }

  const duration = video.duration || clips.at(-1)?.end || 1;
  clips.forEach((clip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `clip${clip.id === selectedClipId ? " active" : ""}`;
    button.style.flex = String(Math.max(0.1, clip.end - clip.start));
    button.innerHTML = `<strong>${clip.name}</strong><span>${formatTime(clip.start)} – ${formatTime(clip.end)}</span>`;
    button.addEventListener("click", () => selectClip(clip.id));
    clipTrack.append(button);
  });

  const tickCount = 5;
  for (let index = 0; index <= tickCount; index += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${index / tickCount * 100}%`;
    tick.textContent = formatTime(duration * index / tickCount);
    ruler.append(tick);
  }

  renderComponentTimeline(duration);
}

function renderComponentTimeline(duration) {
  componentLayers.innerHTML = "";

  if (components.length === 0) {
    const row = document.createElement("div");
    row.className = "layer-row empty-layer-row";
    row.innerHTML = `<div class="layer-label"><strong>UI</strong><span>No layers yet</span></div><div class="component-lane"><span class="empty-layer-message">${clips.length ? "Add a component to create a layer" : "Open a video to add UI layers"}</span></div>`;
    const emptyLane = row.querySelector(".component-lane");
    emptyLane.addEventListener("click", (event) => seekFromTimeline(event, emptyLane));
    componentLayers.append(row);
    return;
  }

  components.forEach((component, index) => {
    const row = document.createElement("div");
    row.className = `layer-row component-layer-row${component.id === selectedComponentId ? " active" : ""}`;

    const layerLabel = document.createElement("button");
    layerLabel.type = "button";
    layerLabel.className = "layer-label component-layer-label";
    const layerName = document.createElement("strong");
    layerName.textContent = component.name;
    const layerType = document.createElement("span");
    layerType.textContent = `${component.kind} · layer ${index + 1}${component.sceneChange?.enabled ? " · scene change" : ""}`;
    layerLabel.append(layerName, layerType);
    layerLabel.addEventListener("click", () => selectComponent(component.id));

    const lane = document.createElement("div");
    lane.className = "component-lane";
    lane.addEventListener("click", (event) => seekFromTimeline(event, lane));
    const bar = document.createElement("div");
    bar.className = `component-bar${component.id === selectedComponentId ? " active" : ""}`;
    bar.dataset.kind = component.kind;
    bar.dataset.componentId = component.id;
    bar.style.left = `${component.start / duration * 100}%`;
    bar.style.width = `${Math.max(0.35, (component.end - component.start) / duration * 100)}%`;
    bar.innerHTML = '<span class="resize-handle start" data-resize="start"></span><span class="component-bar-label"></span><span class="resize-handle end" data-resize="end"></span>';
    updateTimingBarLabel(bar, component);
    bar.addEventListener("click", (event) => {
      event.stopPropagation();
      selectComponent(component.id);
    });
    bar.addEventListener("pointerdown", (event) => {
      const mode = event.target.dataset.resize || "move";
      startTimingDrag(event, component, bar, lane, mode, duration);
    });
    lane.append(bar);
    row.append(layerLabel, lane);
    componentLayers.append(row);
  });
}

function updateTimingBarLabel(bar, component) {
  const label = bar.querySelector(".component-bar-label");
  if (label) label.textContent = `${component.name} · ${(component.end - component.start).toFixed(1)}s${component.sceneChange?.enabled ? " · pause" : ""}`;
}

function startTimingDrag(event, component, bar, lane, mode, duration) {
  event.preventDefault();
  event.stopPropagation();
  const clip = clips.find((item) => item.id === component.clipId);
  if (!clip) return;

  selectedClipId = component.clipId;
  selectedComponentId = component.id;
  renderInspector();
  renderOverlays();
  componentLayers.querySelectorAll(".component-bar.active").forEach((item) => item.classList.remove("active"));
  componentLayers.querySelectorAll(".component-layer-row.active").forEach((item) => item.classList.remove("active"));
  bar.closest(".component-layer-row")?.classList.add("active");
  bar.classList.add("active");

  const startPointer = event.clientX;
  const original = { start: component.start, end: component.end };
  const trackWidth = lane.getBoundingClientRect().width || 1;
  const minimumDuration = Math.min(0.2, clip.end - clip.start);
  bar.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const delta = (moveEvent.clientX - startPointer) / trackWidth * duration;
    if (mode === "start") {
      component.start = clamp(original.start + delta, clip.start, component.end - minimumDuration);
    } else if (mode === "end") {
      component.end = clamp(original.end + delta, component.start + minimumDuration, clip.end);
    } else {
      const componentDuration = original.end - original.start;
      component.start = clamp(original.start + delta, clip.start, clip.end - componentDuration);
      component.end = component.start + componentDuration;
    }
    bar.style.left = `${component.start / duration * 100}%`;
    bar.style.width = `${Math.max(0.35, (component.end - component.start) / duration * 100)}%`;
    updateTimingBarLabel(bar, component);
  };

  const stop = () => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", stop);
    bar.removeEventListener("pointercancel", stop);
    ignoreSceneSyncUntil = performance.now() + 500;
    video.currentTime = Math.min(component.end - 0.01, component.start + 0.01);
    renderAll();
    updateTime();
    setStatus(`${component.name} visible from ${formatTime(component.start)} to ${formatTime(component.end)}`);
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", stop);
  bar.addEventListener("pointercancel", stop);
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
  const time = video.currentTime;
  components.filter((component) => component.clipId === selectedClipId && time >= component.start - 0.03 && time < component.end).forEach((component) => {
    const wrapper = document.createElement("div");
    wrapper.className = `overlay-component${component.id === selectedComponentId ? " selected" : ""}`;
    wrapper.dataset.label = component.name;
    Object.assign(wrapper.style, {
      left: `${component.x}%`, top: `${component.y}%`,
      width: `${component.width}%`, height: `${component.height}%`,
    });
    const preview = document.createElement("editor-overlay");
    preview.update(component);
    wrapper.append(preview);
    wrapper.addEventListener("pointerdown", (event) => startDrag(event, component, wrapper));
    wrapper.addEventListener("click", (event) => { event.stopPropagation(); selectComponent(component.id, false); });
    overlayLayer.append(wrapper);
  });
}

function setCanvasRatio(value) {
  if (!Object.hasOwn(canvasRatios, value)) throw new Error("ratio must be 16:9, 9:16, 1:1, or 4:5");
  canvasRatio = value;
  refs.canvasRatio.value = value;
  canvasFrame.dataset.ratio = value;
  renderOverlays();
  renderMediaDetails();
  setStatus(`Canvas changed to ${value}`);
  return canvasRatios[value];
}

function startDrag(event, component, element) {
  event.preventDefault();
  selectedClipId = component.clipId;
  selectedComponentId = component.id;
  renderInspector();
  overlayLayer.querySelectorAll(".overlay-component.selected").forEach((item) => item.classList.remove("selected"));
  element.classList.add("selected");
  componentLayers.querySelectorAll(".component-bar").forEach((item) => item.classList.toggle("active", item.dataset.componentId === component.id));
  componentLayers.querySelectorAll(".component-layer-row").forEach((item) => item.classList.toggle("active", item.querySelector(`[data-component-id="${component.id}"]`) !== null));
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

function pauseForSceneChange(time) {
  const pausedComponent = components.find((component) => component.id === pausedAtComponentId);
  if (pausedComponent && (time < pausedComponent.start - 0.05 || time >= pausedComponent.end)) {
    pausedAtComponentId = null;
  }

  if (video.paused) {
    return time;
  }

  const blockingComponent = components.find((component) => (
    isSceneChangingComponent(component)
    && component.sceneChange?.enabled
    && component.sceneChange.pauseAtStart
    && component.id !== pausedAtComponentId
    && time >= component.start
    && time < component.end
  ));

  if (!blockingComponent) {
    return time;
  }

  pausedAtComponentId = blockingComponent.id;
  video.pause();
  video.currentTime = blockingComponent.start;
  selectedClipId = blockingComponent.clipId;
  selectedComponentId = blockingComponent.id;
  renderTimeline();
  setStatus(`${blockingComponent.name} paused playback · waiting for a scene condition`);
  return blockingComponent.start;
}

function updateTime() {
  const duration = video.duration || 0;
  const time = pauseForSceneChange(video.currentTime);
  refs.currentTime.textContent = formatTime(time);
  const percentage = duration ? time / duration * 100 : 0;
  refs.playhead.style.left = `${clamp(percentage, 0, 100)}%`;
  timelineEditor.style.setProperty("--playhead-position", `${clamp(percentage, 0, 100)}%`);
  const current = sceneAt(time);
  if (current && current.id !== selectedClipId && performance.now() >= ignoreSceneSyncUntil) {
    selectedClipId = current.id;
    selectedComponentId = components.find((component) => component.clipId === current.id)?.id || null;
    renderAll();
  } else {
    renderOverlays();
  }
}

function setComponentTiming(componentId, start, end) {
  const component = components.find((item) => item.id === componentId);
  if (!component) throw new Error("component does not exist");
  const clip = clips.find((item) => item.id === component.clipId);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.2) {
    throw new Error("component timing must have a duration of at least 0.2 seconds");
  }
  if (start < clip.start || end > clip.end) {
    throw new Error(`component timing must stay inside ${clip.name}`);
  }
  component.start = start;
  component.end = end;
  selectedClipId = component.clipId;
  selectedComponentId = component.id;
  ignoreSceneSyncUntil = performance.now() + 500;
  video.currentTime = Math.min(end - 0.01, start + 0.01);
  renderAll();
  updateTime();
  setStatus(`${component.name} visible from ${formatTime(start)} to ${formatTime(end)}`);
  return component;
}

function componentMarkup(component) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(component.html);
  return template.content;
}

function componentText(component) {
  const text = componentMarkup(component).textContent.replace(/\s+/g, " ").trim();
  return text || component.name;
}

function routeAction(component, route, value) {
  const destination = clips.find((clip) => clip.id === route?.sceneId && clip.id !== component.clipId);
  if (destination) return { type: "goto_scene", scene: destination.id };
  return { type: "custom", name: "component_action", payload: { component: component.id, value } };
}

function exportChoiceOptions(component) {
  const markup = componentMarkup(component);
  let labels = [...markup.querySelectorAll("button")]
    .map((button) => button.textContent.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (labels.length < 2) labels = ["Option one", "Option two"];
  const routes = component.sceneChange?.routes || [];
  return labels.map((label, index) => {
    const route = routes[index];
    const value = route?.condition || `option_${index + 1}`;
    return { label, value, actions: [routeAction(component, route, value)] };
  });
}

function exportFormFields(component) {
  const fields = [...componentMarkup(component).querySelectorAll("input, select, textarea")];
  const usedNames = new Set();
  return fields.map((field, index) => {
    const proposedName = String(field.getAttribute("name") || `field_${index + 1}`).replace(/[^a-z0-9_-]+/gi, "_");
    let name = proposedName || `field_${index + 1}`;
    while (usedNames.has(name)) name = `${name}_${index + 1}`;
    usedNames.add(name);
    const rawType = field.tagName === "SELECT" ? "choice" : field.getAttribute("type");
    const type = ["number", "email", "choice"].includes(rawType) ? rawType : "text";
    const exported = {
      name,
      label: field.getAttribute("aria-label") || field.getAttribute("placeholder") || name.replaceAll("_", " "),
      type,
      required: field.required,
    };
    if (type === "choice") {
      const options = [...field.querySelectorAll("option")].map((option) => ({
        label: option.textContent.trim() || option.value,
        value: option.value,
      }));
      exported.options = options.length ? options : [{ label: "Option", value: "option" }];
    }
    return exported;
  });
}

function exportComponent(component) {
  const exported = {
    id: component.id,
    kind: component.kind,
    title: component.name,
    html: sanitizeHtml(component.html),
    css: sanitizeCss(component.css),
    presentation: {
      scene: component.clipId,
      start: component.start,
      end: component.end,
      x: component.x / 100,
      y: component.y / 100,
      width: component.width / 100,
      height: component.height / 100,
    },
  };

  if (component.sceneChange) exported.scene_change = structuredClone(component.sceneChange);
  if (component.kind === "tooltip") exported.text = componentText(component);
  if (component.kind === "card") exported.text = componentText(component);
  if (component.kind === "choice") exported.options = exportChoiceOptions(component);
  if (component.kind === "form") {
    exported.fields = exportFormFields(component);
    exported.on_submit = [{
      type: "custom",
      name: "submit_form",
      payload: { component: component.id, routes: structuredClone(component.sceneChange?.routes || []) },
    }];
  }
  return exported;
}

function buildPvoManifest() {
  if (!mediaReady || !sourceMedia || clips.length === 0) throw new Error("Open a video before exporting");
  const title = sourceMediaName.replace(/\.pvo\.mp4$/i, "").replace(/\.mp4$/i, "") || "PVO video";
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "pvo_video";
  const exportedComponents = components.map(exportComponent);
  const triggers = components.flatMap((component) => ([
    {
      id: `${component.id}_show`,
      scene: component.clipId,
      at: component.start,
      actions: [{ type: "show", component: component.id }],
    },
    {
      id: `${component.id}_hide`,
      scene: component.clipId,
      at: component.end,
      actions: [{ type: "hide", component: component.id }],
    },
  ]));
  const ratio = canvasRatios[canvasRatio];

  return {
    spec_version: PVO_SPEC_VERSION,
    id,
    title,
    initial_scene: clips[0].id,
    canvas: { ratio: canvasRatio, width: ratio.width, height: ratio.height },
    state: { initial: {} },
    scenes: clips.map((clip) => ({ id: clip.id, label: clip.name, start: clip.start, end: clip.end })),
    components: exportedComponents,
    hotspots: [],
    triggers,
  };
}

function exportedFileName() {
  const base = sourceMediaName.replace(/\.pvo\.mp4$/i, "").replace(/\.mp4$/i, "") || "video";
  return `${base}.pvo.mp4`;
}

async function exportPvoVideo() {
  if (!mediaReady || !sourceMedia || exporting) return;
  exporting = true;
  refs.exportPvoButton.disabled = true;
  refs.exportPvoButton.textContent = "Exporting…";
  setStatus("Packing PVO video…");
  try {
    const output = await packPvo(sourceMedia, buildPvoManifest());
    const name = exportedFileName();
    const downloadUrl = URL.createObjectURL(output);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
    setStatus(`${name} exported`);
  } catch (error) {
    console.error("PVO export failed", error);
    setStatus(`Export failed · ${error.message}`);
  } finally {
    exporting = false;
    refs.exportPvoButton.textContent = "Export PVO video";
    refs.exportPvoButton.disabled = !mediaReady || !sourceMedia;
  }
}

function loadVideo(source, name) {
  const previousObjectUrl = objectUrl;
  objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
  sourceMedia = source instanceof Blob ? source : null;
  sourceMediaName = name;
  clips = [];
  components = [];
  selectedClipId = null;
  selectedComponentId = null;
  refs.currentTime.textContent = "00:00.0";
  refs.totalTime.textContent = "00:00.0";
  refs.projectDuration.textContent = "00:00.0";
  video.src = objectUrl || source;
  if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
  refs.projectName.textContent = name;
  setMediaReady(false, { title: "Loading video…", message: `Preparing ${name}` });
  renderAll();
  setStatus(`Loading ${name}`);
  video.load();
}

video.addEventListener("loadedmetadata", () => {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (duration <= 0) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    sourceMedia = null;
    sourceMediaName = "";
    refs.projectName.textContent = "No video selected";
    setMediaReady(false, { title: "Could not open this video", message: "Choose an MP4 file and try again." });
    setStatus("Video could not be opened");
    return;
  }
  refs.totalTime.textContent = formatTime(duration);
  refs.projectDuration.textContent = formatTime(duration);
  clips = [{ id: `scene_${++clipCounter}`, name: "Scene 1", start: 0, end: duration }];
  components = [];
  pausedAtComponentId = null;
  selectedClipId = clips[0].id;
  selectedComponentId = null;
  setMediaReady(true);
  renderAll();
  setStatus("Video ready · split the clip or add a component");
});
video.addEventListener("error", () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  sourceMedia = null;
  sourceMediaName = "";
  clips = [];
  components = [];
  selectedClipId = null;
  selectedComponentId = null;
  refs.projectName.textContent = "No video selected";
  refs.projectDuration.textContent = "00:00.0";
  refs.currentTime.textContent = "00:00.0";
  refs.totalTime.textContent = "00:00.0";
  setMediaReady(false, { title: "Could not open this video", message: "Choose an MP4 file and try again." });
  renderAll();
  setStatus("Video could not be opened");
});
video.addEventListener("timeupdate", updateTime);
video.addEventListener("seeked", updateTime);
window.addEventListener("resize", positionCanvasFrame);
new ResizeObserver(positionCanvasFrame).observe(videoArea);

addComponentButtons.forEach((button) => button.addEventListener("click", () => addComponent(button.dataset.addComponent)));
refs.splitButton.addEventListener("click", () => { try { splitAtPlayhead(); } catch { /* status explains the invalid split */ } });
$("#deleteComponentButton").addEventListener("click", deleteComponent);
$("#closeComponentDialog").addEventListener("click", closeComponentDialog);
$("#doneComponentDialog").addEventListener("click", closeComponentDialog);
$("#addSceneRoute").addEventListener("click", addSceneRoute);
refs.changeSceneToggle.addEventListener("change", () => {
  const component = selectedComponent();
  if (!isSceneChangingComponent(component)) return;
  const sceneChange = ensureSceneChange(component);
  sceneChange.enabled = refs.changeSceneToggle.checked;
  pausedAtComponentId = null;
  renderSceneRouting(component);
  renderTimeline();
  setStatus(`${component.name} scene change ${sceneChange.enabled ? "enabled" : "disabled"}`);
});
refs.componentDialog.addEventListener("click", (event) => {
  if (event.target === refs.componentDialog) closeComponentDialog();
});
[refs.name, refs.x, refs.y, refs.width, refs.height, refs.html, refs.css].forEach((input) => input.addEventListener("input", updateComponentFromInspector));
refs.videoInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) loadVideo(file, file.name);
  event.target.value = "";
});
refs.chooseVideoButton.addEventListener("click", () => refs.videoInput.click());
refs.replaceMediaButton.addEventListener("click", () => refs.videoInput.click());
refs.exportPvoButton.addEventListener("click", exportPvoVideo);
refs.canvasRatio.addEventListener("change", () => setCanvasRatio(refs.canvasRatio.value));
refs.mediaTab.addEventListener("click", () => setPanelTab("media"));
refs.componentsTab.addEventListener("click", () => setPanelTab("components"));
[refs.mediaTab, refs.componentsTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const next = tab === refs.mediaTab ? refs.componentsTab : refs.mediaTab;
  setPanelTab(next === refs.mediaTab ? "media" : "components");
  next.focus();
}));

function seekFromTimeline(event, lane) {
  const bounds = lane.getBoundingClientRect();
  const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  video.currentTime = ratio * (video.duration || 0);
  updateTime();
}

trackWrap.addEventListener("click", (event) => seekFromTimeline(event, trackWrap));
ruler.addEventListener("click", (event) => seekFromTimeline(event, ruler));

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const report = (error) => console.warn("WebMCP registration failed", error);
  const register = (tool) => {
    try { void Promise.resolve(context.registerTool(tool)).catch(report); } catch (error) { report(error); }
  };
  register({
    name: "read_editor_state",
    title: "Read editor state",
    description: "Read the current scene ranges and components in the PVO editor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return { mediaLoaded: mediaReady, mediaName: sourceMediaName || null, canvasRatio, selectedScene: selectedClipId, selectedComponent: selectedComponentId, scenes: structuredClone(clips), components: structuredClone(components) };
    },
  });
  register({
    name: "set_canvas_ratio",
    title: "Set canvas ratio",
    description: "Set the editor canvas to a supported landscape, portrait, square, or social ratio.",
    inputSchema: { type: "object", properties: { ratio: { enum: ["16:9", "9:16", "1:1", "4:5"] } }, required: ["ratio"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const ratio = setCanvasRatio(input?.ratio);
      return { ratio: canvasRatio, width: ratio.width, height: ratio.height };
    },
  });
  register({
    name: "split_scene_at_time",
    title: "Split scene at time",
    description: "Split the visible video scene at an absolute time in seconds and select the new right-hand scene.",
    inputSchema: { type: "object", properties: { time: { type: "number", minimum: 0 } }, required: ["time"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!Number.isFinite(input?.time)) throw new Error("time must be a number");
      const scene = splitSceneAt(input.time);
      return { scene: scene.id, start: scene.start, end: scene.end, sceneCount: clips.length };
    },
  });
  register({
    name: "add_editor_component",
    title: "Add editor component",
    description: "Add a tooltip, card, choice, or form to the currently selected scene.",
    inputSchema: { type: "object", properties: { kind: { enum: ["tooltip", "card", "choice", "form"] } }, required: ["kind"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!Object.hasOwn(presets, input?.kind)) throw new Error("kind must be tooltip, card, choice, or form");
      const component = addComponent(input.kind, false);
      return { component: component.id, kind: component.kind, scene: component.clipId, start: component.start, end: component.end };
    },
  });
  register({
    name: "set_component_timing",
    title: "Set component timing",
    description: "Set when a component appears and disappears, using absolute seconds within its scene.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string" },
        start: { type: "number", minimum: 0 },
        end: { type: "number", minimum: 0 },
      },
      required: ["componentId", "start", "end"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const component = setComponentTiming(input?.componentId, input?.start, input?.end);
      return { component: component.id, scene: component.clipId, start: component.start, end: component.end };
    },
  });
  register({
    name: "set_component_scene_routing",
    title: "Set component scene routing",
    description: "Configure a choice or form to pause playback and map declared conditions or results to destination scenes.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string" },
        enabled: { type: "boolean" },
        routes: {
          type: "array",
          items: {
            type: "object",
            properties: { condition: { type: "string" }, sceneId: { type: "string" } },
            required: ["condition", "sceneId"],
            additionalProperties: false,
          },
        },
      },
      required: ["componentId", "enabled", "routes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const component = setComponentSceneRouting(input?.componentId, input?.enabled, input?.routes);
      return { component: component.id, scene: component.clipId, sceneChange: structuredClone(component.sceneChange) };
    },
  });
}

setPanelTab("media");
setMediaReady(false);
renderAll();
registerWebMcpTools();
