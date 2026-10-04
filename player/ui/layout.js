import { fitFootage, footageComponentScale, placeComponent, placeSticker } from "./layout-geometry.js";
import { createAmbientVideo } from "../media/ambient.js";

function setVariable(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function setData(element, name, value) {
  const text = String(value);
  if (element.dataset[name] !== text) element.dataset[name] = text;
}

function focusedControl() {
  let element = document.activeElement;
  while (element) {
    const child = element.shadowRoot?.activeElement
      || (element.tagName === "IFRAME" ? element.contentDocument?.activeElement : null);
    if (!child || child === element) break;
    element = child;
  }
  return element?.matches?.("input:not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]")
    ? element : null;
}

function aspectRatio(session, video) {
  const canvas = session?.manifest?.canvas;
  if (canvas?.width > 0 && canvas?.height > 0) return canvas.width / canvas.height;
  if (canvas?.ratio) {
    const [width, height] = canvas.ratio.split(":").map(Number);
    if (width > 0 && height > 0) return width / height;
  }
  return video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 9 / 16;
}

/** Browser measurements and lifecycle for the responsive player composition. */
export function createPlayerLayout({ refs, session }) {
  const { frame, video, overlay, shell } = refs;
  const status = refs.statusWidget;
  const brand = refs.brand;
  const ambient = createAmbientVideo({ video, canvas: refs.ambient });
  const placements = new Map();
  let scheduled = 0;
  let destroyed = false;
  let viewportWidth = window.innerWidth;
  let fullViewportHeight = window.innerHeight;
  let keyboardReserve = 156;

  function schedule() {
    if (!destroyed && !scheduled) scheduled = window.requestAnimationFrame(update);
  }

  function readKeyboard() {
    const viewport = window.visualViewport;
    if (viewportWidth !== window.innerWidth) {
      viewportWidth = window.innerWidth;
      fullViewportHeight = window.innerHeight;
    }
    fullViewportHeight = Math.max(fullViewportHeight, window.innerHeight);
    const visibleHeight = viewport?.height ?? window.innerHeight;
    const reduced = fullViewportHeight - visibleHeight > 120;
    const keyboard = Boolean(viewport && viewport.scale === 1 && reduced && focusedControl());
    setData(shell, "keyboard", keyboard);
    shell.classList.toggle("keyboard-open", keyboard);
    setVariable(shell, "--keyboard-visible-height", `${Math.round(visibleHeight)}px`);
    return keyboard;
  }

  function unliftedBounds(node, frameBounds) {
    const rect = node.getBoundingClientRect();
    const previous = placements.get(node) || { scale: 1, shiftX: 0, shiftY: 0 };
    const width = rect.width / previous.scale;
    const height = rect.height / previous.scale;
    return {
      left: rect.left - frameBounds.left + (rect.width - width) / 2 - previous.shiftX,
      top: rect.top - frameBounds.top + (rect.height - height) / 2 - previous.shiftY,
      width,
      height,
    };
  }

  function applyPlacement(node, bounds, placement, footage) {
    const shiftX = placement.left + placement.width / 2 - bounds.left - bounds.width / 2;
    const shiftY = placement.top + placement.height / 2 - bounds.top - bounds.height / 2;
    const previous = placements.get(node);
    const outline = previous?.outline || document.createElement("div");
    if (!previous) {
      outline.className = "component-lift-outline";
      outline.setAttribute("aria-hidden", "true");
    }
    setVariable(node, "--component-lift-x", `${shiftX}px`);
    setVariable(node, "--component-lift-y", `${shiftY}px`);
    setVariable(node, "--component-lift-scale", String(placement.scale));
    setData(node, "lifted", placement.direction);
    if (placement.direction) {
      Object.assign(outline.style, {
        left: `${bounds.left - footage.left}px`, top: `${bounds.top - footage.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`,
      });
      if (!outline.isConnected) overlay.append(outline);
    } else {
      outline.remove();
    }
    placements.set(node, { scale: placement.scale, shiftX, shiftY, outline });
  }

  function positionStickers({ stage, footage, components, layout, keyboard, topZone, direction }) {
    const compact = layout === "phone" || layout === "tablet";
    const expanded = compact && !keyboard && !topZone
      && ["paused", "finished"].includes(frame.dataset.state || shell.dataset.state);
    brand?.classList.toggle("is-expanded", expanded);
    if (refs.brandCreate) refs.brandCreate.tabIndex = expanded ? 0 : -1;
    const bottom = footage.top + footage.height;
    const brandBox = placeSticker({
      left: expanded ? 12 : stage.width - 56,
      top: topZone ? bottom - 64 : 12,
      width: expanded ? stage.width - 24 : 44,
      height: 44,
    }, stage, components);
    const brandVisible = compact && !keyboard && !brandBox.hidden;
    const obstacles = brandVisible ? [...components, brandBox] : components;
    const statusBox = placeSticker({
      left: compact ? 12 : footage.left + 12,
      top: topZone ? bottom - 64 : compact ? expanded ? 64 : 12 : footage.top + 12,
      width: Math.min(status?.offsetWidth || 140, stage.width - 24),
      height: 44,
    }, stage, obstacles);
    setVariable(frame, "--status-left", `${statusBox.left}px`);
    setVariable(frame, "--status-top", `${statusBox.top}px`);
    setVariable(frame, "--brand-top", `${brandBox.top}px`);
    setVariable(frame, "--brand-left", "auto");
    setVariable(frame, "--brand-right", "12px");
    setData(frame, "statusOccluded", statusBox.hidden);
    setData(frame, "brandOccluded", brandBox.hidden);
    const center = placeSticker({
      left: footage.left + footage.width / 2 - 32,
      top: footage.top + footage.height / 2 - 32,
      width: 64, height: 64,
    }, stage, [...obstacles, statusBox]);
    setVariable(frame, "--center-left", `${center.left + 32}px`);
    setVariable(frame, "--center-top", `${center.top + 32}px`);
    setData(frame, "centerOccluded", center.hidden);
    if (refs.holdArrow) refs.holdArrow.textContent = topZone ? "↑" : direction === "right" ? "→" : "↓";
  }

  function update() {
    if (destroyed) return;
    if (scheduled) window.cancelAnimationFrame(scheduled);
    scheduled = 0;
    const keyboard = readKeyboard();
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (!width || !height) return;
    const layout = getComputedStyle(frame).getPropertyValue("--player-layout").trim() || "phone";
    const contentHeight = keyboard ? Math.max(80, height - keyboardReserve) : height;
    const stage = { width, height, contentHeight };
    const footage = fitFootage(width, contentHeight, aspectRatio(session, video));
    for (const dimension of ["left", "top", "width", "height"]) {
      setVariable(frame, `--video-${dimension}`, `${footage[dimension]}px`);
    }
    const componentScale = footageComponentScale(footage);
    const designWidth = footage.width / footage.height > 1 ? 390 : 348;
    setVariable(overlay, "--component-unit", String(componentScale * designWidth / 247));
    const frameBounds = frame.getBoundingClientRect();
    const nodes = [...overlay.querySelectorAll(".component-position.interactive")];
    for (const [node, previous] of placements) {
      if (!nodes.includes(node)) {
        previous.outline.remove();
        placements.delete(node);
        componentObserver.unobserve(node);
      }
    }
    const components = [];
    let topZone = false;
    let bottomZone = false;
    let direction = "";
    let nextKeyboardReserve = 156;
    nodes.forEach(node => {
      if (!placements.has(node)) componentObserver.observe(node);
      const bounds = unliftedBounds(node, frameBounds);
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const form = node.dataset.componentKind === "form";
      const placement = placeComponent({
        stage, footage, bounds, keyboard: keyboard && form,
        large: layout !== "phone", occupied: components,
        preservePosition: node.dataset.authoredMotion === "true" || node.dataset.belowVideo === "true",
      });
      applyPlacement(node, bounds, placement, footage);
      components.push(placement);
      if (placement.direction) direction = placement.direction;
      else {
        topZone ||= placement.top < footage.top + 120;
        bottomZone ||= placement.top + placement.height > footage.top + footage.height - 110;
      }
      if (form) nextKeyboardReserve = Math.max(nextKeyboardReserve, bounds.height / componentScale + 60);
    });
    setData(frame, "topZone", topZone);
    setData(frame, "bottomZone", bottomZone);
    setData(frame, "liftDirection", direction);
    positionStickers({ stage, footage, components, layout, keyboard, topZone, direction });
    const boundedReserve = Math.min(height * 0.65, Math.ceil(nextKeyboardReserve));
    if (Math.abs(keyboardReserve - boundedReserve) > 1) {
      keyboardReserve = boundedReserve;
      if (keyboard) schedule();
    }
  }

  function dismissKeyboard() {
    focusedControl()?.blur();
    schedule();
  }

  const componentObserver = new ResizeObserver(schedule);
  const frameObserver = new ResizeObserver(schedule);
  frameObserver.observe(frame);
  if (status) frameObserver.observe(status);
  if (brand) frameObserver.observe(brand);
  const mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(overlay, { childList: true, subtree: true });
  const stateObserver = new MutationObserver(schedule);
  stateObserver.observe(frame, { attributes: true, attributeFilter: ["data-state"] });
  video.addEventListener("loadedmetadata", schedule);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  refs.keyboardDone?.addEventListener("click", dismissKeyboard);
  schedule();
  return {
    update,
    dismissKeyboard,
    destroy() {
      destroyed = true;
      window.cancelAnimationFrame(scheduled);
      componentObserver.disconnect();
      frameObserver.disconnect();
      mutationObserver.disconnect();
      stateObserver.disconnect();
      video.removeEventListener("loadedmetadata", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      refs.keyboardDone?.removeEventListener("click", dismissKeyboard);
      placements.forEach(placement => placement.outline.remove());
      placements.clear();
      ambient.destroy();
    },
  };
}
