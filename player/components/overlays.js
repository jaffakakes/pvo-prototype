import { drawText } from "../../packages/pvo-text-runtime/index.js";
import { mountCustomComponent } from "../../packages/pvo-code-runtime/index.js";
import { canvasPixelSize, componentPixelTransform, componentSize, observeComponentSize } from "../../packages/pvo-component-runtime/index.js";
import { componentWithRuntimeState } from "./state.js";
import { observeDiagnostic } from "../../packages/pvo-sdk/index.js";

export function createOverlayRenderer({ session, refs, adapters }) {
  const sizeObservers = new Set();
  function destroyCustomOverlays() {
    sizeObservers.forEach(disconnect => disconnect());
    sizeObservers.clear();
    session.mountedCustom.forEach((mounted) => mounted.destroy());
    session.mountedCustom.clear();
  }

  function renderOverlays(force = false) {
    const visible = session.finished ? [] : adapters.visibleComponents();
    const sceneLayers = session.captureMode ? session.manifest.restyle_capture?.scene_layers?.[adapters.activeClip()?.scene] : null;
    const order = Array.isArray(sceneLayers?.order) ? sceneLayers.order : [];
    const texts = session.finished ? [] : (sceneLayers?.texts || []).filter(text => adapters.elapsedTime() >= text.start && adapters.elapsedTime() < text.end);
    const key = visible.map((component) => component.id).join("|")
      + `:${session.currentTimeline?.id}:${texts.map(text => text.id).join(",")}:${refs.frame.clientWidth}:${session.runtimeStateRevision}`;
    if (!force && key === session.renderedOverlayKey) return;
    session.renderedOverlayKey = key;
    destroyCustomOverlays();
    refs.overlay.innerHTML = "";
    refs.overlay.style.zIndex = sceneLayers ? "auto" : "2";
    refs.video.style.position = sceneLayers ? "relative" : "";
    refs.video.style.zIndex = sceneLayers ? String(Math.max(0, order.indexOf("video")) + 1) : "";
    for (const text of texts) {
      const canvas = document.createElement("canvas");
      canvas.className = "capture-text";
      canvas.dataset.layerId = `text:${text.id}`;
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${order.indexOf(`text:${text.id}`) + 1}`;
      const width = refs.frame.clientWidth, height = refs.frame.clientHeight;
      canvas.width = width * 2; canvas.height = height * 2;
      const context = canvas.getContext("2d");
      if (context) { context.scale(2, 2); drawText(context, width, height, text); }
      refs.overlay.append(canvas);
    }
    visible.forEach((component) => {
      const presentation = component.presentation || {};
      const position = document.createElement("div");
      const custom = session.captureMode && session.pvoLanguageSources.has(component.id);
      const interactive = custom || (session.captureMode ? component.kind !== "tooltip" : ["card", "choice", "form"].includes(component.kind));
      position.className = `component-position${interactive ? " interactive" : ""}${session.captureMode ? " capture-position" : ""}`;
      if (custom) position.classList.add("code-position", `code-${component.kind}`);
      if (session.captureMode) {
        if (sceneLayers) position.style.zIndex = String(order.indexOf(`component:${component.id}`) + 1);
        position.dataset.layerId = `component:${component.id}`;
        position.style.left = `${Number(component.restyle_capture?.x ?? ((presentation.x ?? 0) + (presentation.width ?? 1) / 2) * 100)}%`;
        position.style.top = `${Number(component.restyle_capture?.y ?? ((presentation.y ?? 0) + (presentation.height ?? 1) / 2) * 100)}%`;
        const size = componentSize(component.restyle_capture);
        position.style.transform = `translate(-50%, -50%) scale(${size.width}, ${size.height})`;
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
      if (session.captureMode && (component.restyle_capture?.width !== undefined || component.restyle_capture?.height !== undefined)) {
        const canvas = canvasPixelSize(session.manifest.canvas?.width, session.manifest.canvas?.height);
        sizeObservers.add(observeComponentSize(position, natural => {
          const unit = canvas.width / refs.frame.clientWidth;
          const scale = componentPixelTransform(component.restyle_capture, { width: natural.width * unit, height: natural.height * unit });
          position.style.transform = `translate(-50%, -50%) scale(${scale.width}, ${scale.height})`;
        }));
      }
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
