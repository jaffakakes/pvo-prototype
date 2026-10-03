import { drawText } from "../../packages/pvo-text-runtime/index.js";
import { mountCustomComponent } from "../../packages/pvo-code-runtime/index.js";
import { applyVideoMotion } from "./video-motion.js";
import { createComponentMotion } from "./motion.js";
import { componentWithRuntimeState } from "./state.js";
import { observeDiagnostic } from "../../packages/pvo-sdk/index.js";

export function createOverlayRenderer({ session, refs, adapters }) {
  const entries = new Map();
  const textEntries = new Map();
  let sceneKey = null;
  function destroyCustomOverlays() {
    entries.forEach(entry => { entry.motion?.dispose(); entry.position.remove(); });
    entries.clear();
    textEntries.forEach(canvas => canvas.remove());
    textEntries.clear();
    sceneKey = null;
    session.mountedCustom.forEach((mounted) => mounted.destroy());
    session.mountedCustom.clear();
  }

  function renderOverlays() {
    const visible = session.finished ? [] : adapters.visibleComponents();
    const sceneLayers = session.captureMode ? session.manifest.restyle_capture?.scene_layers?.[adapters.activeClip()?.scene] : null;
    const order = Array.isArray(sceneLayers?.order) ? sceneLayers.order : [];
    const texts = session.finished ? [] : (sceneLayers?.texts || []).filter(text => adapters.elapsedTime() >= text.start && adapters.elapsedTime() < text.end);
    const nextScene = `${session.currentTimeline?.id}:${adapters.activeClip()?.scene}:${session.overlayResetRevision ?? 0}`;
    if (sceneKey !== nextScene) {
      destroyCustomOverlays();
      refs.overlay.innerHTML = "";
      sceneKey = nextScene;
    }
    const activeIds = new Set(visible.map(component => component.id));
    for (const [id, entry] of entries) {
      if (activeIds.has(id)) continue;
      entry.motion?.dispose();
      session.mountedCustom.get(id)?.destroy();
      session.mountedCustom.delete(id);
      entry.position.remove();
      entries.delete(id);
    }
    const textIds = new Set(texts.map(text => text.id));
    for (const [id, canvas] of textEntries) {
      if (!textIds.has(id)) { canvas.remove(); textEntries.delete(id); }
    }
    applyVideoMotion(refs.video, sceneLayers?.clips, adapters.elapsedTime(),
      adapters.activeClip()?.end - adapters.activeClip()?.start);
    refs.overlay.style.zIndex = sceneLayers ? "auto" : "2";
    refs.video.style.position = sceneLayers ? "relative" : "";
    refs.video.style.zIndex = sceneLayers ? String(Math.max(0, order.indexOf("video")) + 1) : "";
    for (const text of texts) {
      let canvas = textEntries.get(text.id);
      if (!canvas) {
        canvas = document.createElement("canvas");
        textEntries.set(text.id, canvas);
        refs.overlay.append(canvas);
      }
      canvas.className = "capture-text";
      canvas.dataset.layerId = `text:${text.id}`;
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${order.indexOf(`text:${text.id}`) + 1}`;
      const width = refs.frame.clientWidth, height = refs.frame.clientHeight;
      canvas.width = width * 2; canvas.height = height * 2;
      const context = canvas.getContext("2d");
      if (context) { context.scale(2, 2); drawText(context, width, height, text, adapters.elapsedTime() - text.start); }
    }
    visible.forEach((component) => {
      const retained = entries.get(component.id);
      if (retained) { retained.motion?.apply(); return; }
      const presentation = component.presentation || {};
      const position = document.createElement("div");
      const custom = session.captureMode && session.pvoLanguageSources.has(component.id);
      const interactive = custom || (session.captureMode ? component.kind !== "tooltip" : ["card", "choice", "form"].includes(component.kind));
      position.className = `component-position${interactive ? " interactive" : ""}${session.captureMode ? " capture-position" : ""}`;
      if (custom) position.classList.add("code-position", `code-${component.kind}`);
      if (session.captureMode) {
        if (sceneLayers) position.style.zIndex = String(order.indexOf(`component:${component.id}`) + 1);
        position.dataset.layerId = `component:${component.id}`;
      } else {
        position.style.left = `${Number(presentation.x || 0) * 100}%`;
        position.style.top = `${Number(presentation.y || 0) * 100}%`;
        position.style.width = `${Number(presentation.width || 1) * 100}%`;
        position.style.height = `${Number(presentation.height || 1) * 100}%`;
      }
      refs.overlay.append(position);
      if (custom) {
        const source = session.pvoLanguageSources.get(component.id);
        const mounted = mountCustomComponent(position, {
          ...source,
          state: component.kind === "tooltip" ? session.actionRuntime?.state ?? {} : undefined,
          componentId: component.id,
          font: component.restyle_capture?.font,
          interactive: true,
          ...(typeof session.onDiagnostic === "function" ? {
            onDiagnostic: event => {
              if (event.type.startsWith("component.")) observeDiagnostic(session.onDiagnostic, {
                type: event.type, componentId: component.id, reason: event.reason,
              });
            },
          } : {}),
          onAction: (action) => {
            if (position.isConnected && session.mountedCustom.get(component.id) === mounted) return adapters.handleCustomAction(component, action);
            return undefined;
          },
          onError: (error) => adapters.setStatus(`PVO · ${String(error?.message || error)}`, true),
        });
        session.mountedCustom.set(component.id, mounted);
        mounted.setPending(session.pendingComponents.has(component.id));
      } else {
        const view = document.createElement("pvo-component-view");
        const response = session.capturedResponses.get(component.id);
        const selected = (component.kind === "choice" || component.kind === "card") && response
          ? response.index : undefined;
        const displayed = componentWithRuntimeState(component, session.actionRuntime?.state);
        view.update(displayed, selected, session.captureMode, refs.frame.clientWidth / 247);
        view.setPending?.(session.pendingComponents.has(component.id));
        position.append(view);
      }
      const motion = session.captureMode ? createComponentMotion(position, component, {
        frame: refs.frame, manifest: session.manifest, elapsedTime: adapters.elapsedTime, custom,
      }) : null;
      entries.set(component.id, { position, motion });
    });
  }

  function setComponentPending(componentId, pending) {
    session.mountedCustom.get(componentId)?.setPending(pending);
    refs.overlay.querySelectorAll("pvo-component-view").forEach(view => {
      if (view.componentId === componentId) view.setPending?.(pending);
    });
  }

  /** Refresh one answered/pending control without replacing unrelated live form DOM. */
  function updateComponentResponse(componentId) {
    const component = session.manifest?.components?.find((item) => item.id === componentId);
    if (!component) return;
    session.mountedCustom.get(componentId)?.setPending(session.pendingComponents.has(componentId));
    refs.overlay.querySelectorAll("pvo-component-view").forEach(view => {
      if (view.componentId !== componentId) return;
      const response = session.capturedResponses.get(componentId);
      const selected = (component.kind === "choice" || component.kind === "card") && response
        ? response.index : undefined;
      view.update(componentWithRuntimeState(component, session.actionRuntime?.state), selected,
        session.captureMode, refs.frame.clientWidth / 247);
      view.setPending?.(session.pendingComponents.has(componentId));
    });
  }

  /** Refresh visible Notes without rebuilding unrelated interactive component DOM. */
  function updateRuntimeState(state = {}) {
    const components = new Map((session.manifest?.components || []).map(component => [component.id, component]));
    session.mountedCustom.forEach((mounted, componentId) => {
      if (components.get(componentId)?.kind === "tooltip") mounted.update({ state });
    });
    refs.overlay.querySelectorAll("pvo-component-view").forEach(view => {
      const component = components.get(view.componentId);
      if (component?.kind !== "tooltip") return;
      view.update(componentWithRuntimeState(component, state), undefined,
        session.captureMode, refs.frame.clientWidth / 247);
    });
  }

  return {
    renderOverlays,
    destroyCustomOverlays,
    setComponentPending,
    updateComponentResponse,
    updateRuntimeState,
  };
}
