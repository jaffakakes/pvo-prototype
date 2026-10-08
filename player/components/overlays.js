import { componentAction } from "../actions/selection.js";
import { mountServiceRecovery } from "../services/recovery-view.js";
import { drawText } from "../../packages/pvo-text-runtime/index.js";
import { mountCustomComponent } from "../../packages/pvo-code-runtime/index.js";
import { applyVideoMotion } from "./video-motion.js";
import { createComponentMotion } from "./motion.js";
import { componentWithRuntimeState } from "./state.js";
import { observeDiagnostic } from "../../packages/pvo-sdk/index.js";
import { canvasPixelSize } from "../../packages/pvo-component-runtime/index.js";

export function createOverlayRenderer({ session, refs, adapters, services }) {
  const entries = new Map();
  const textEntries = new Map();
  let sceneKey = null;
  function destroyCustomOverlays() {
    entries.forEach((entry) => {
      entry.recovery?.dispose();
      entry.motion?.dispose();
      entry.position.remove();
    });
    entries.clear();
    textEntries.forEach((canvas) => canvas.remove());
    textEntries.clear();
    sceneKey = null;
    session.mountedCustom.forEach((mounted) => mounted.destroy());
    session.mountedCustom.clear();
  }

  function renderOverlays() {
    const visible = session.finished ? [] : adapters.visibleComponents();
    const sceneLayers = session.captureMode
      ? session.manifest.restyle_capture?.scene_layers?.[
          adapters.activeClip()?.scene
        ]
      : null;
    const order = Array.isArray(sceneLayers?.order) ? sceneLayers.order : [];
    const texts = session.finished
      ? []
      : (sceneLayers?.texts || []).filter(
          (text) =>
            adapters.elapsedTime() >= text.start &&
            adapters.elapsedTime() < text.end,
        );
    const nextScene = `${session.currentTimeline?.id}:${adapters.activeClip()?.scene}:${session.overlayResetRevision ?? 0}`;
    if (sceneKey !== nextScene) {
      destroyCustomOverlays();
      refs.overlay.innerHTML = "";
      sceneKey = nextScene;
    }
    const activeIds = new Set(visible.map((component) => component.id));
    for (const [id, entry] of entries) {
      if (activeIds.has(id)) continue;
      entry.recovery?.dispose();
      entry.motion?.dispose();
      session.mountedCustom.get(id)?.destroy();
      session.mountedCustom.delete(id);
      entry.position.remove();
      entries.delete(id);
    }
    const textIds = new Set(texts.map((text) => text.id));
    for (const [id, canvas] of textEntries) {
      if (!textIds.has(id)) {
        canvas.remove();
        textEntries.delete(id);
      }
    }
    applyVideoMotion(
      refs.video,
      sceneLayers?.clips,
      adapters.elapsedTime(),
      adapters.activeClip()?.end - adapters.activeClip()?.start,
    );
    // Keep authored layers on both sides of the video: animated footage can
    // reveal a lower layer. Chrome and dimming use separate stack positions.
    const videoLayer = sceneLayers
      ? Math.max(0, order.indexOf("video")) * 2 + 2
      : 2;
    refs.overlay.style.zIndex = sceneLayers ? "auto" : "4";
    refs.video.style.zIndex = String(videoLayer);
    refs.frame.style.setProperty("--video-layer-z", String(videoLayer));
    refs.frame.style.setProperty(
      "--player-chrome-layer",
      String(order.length * 2 + 10),
    );
    for (const text of texts) {
      let canvas = textEntries.get(text.id);
      if (!canvas) {
        canvas = document.createElement("canvas");
        textEntries.set(text.id, canvas);
        refs.overlay.append(canvas);
      }
      canvas.className = "capture-text";
      canvas.dataset.layerId = `text:${text.id}`;
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${order.indexOf(`text:${text.id}`) * 2 + 2}`;
      const { width, height } = canvasPixelSize(
        session.manifest.canvas?.width,
        session.manifest.canvas?.height,
      );
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context)
        drawText(
          context,
          width,
          height,
          text,
          adapters.elapsedTime() - text.start,
        );
    }
    visible.forEach((component) => {
      const retained = entries.get(component.id);
      if (retained) {
        retained.motion?.apply();
        return;
      }
      const presentation = component.presentation || {};
      const position = document.createElement("div");
      const custom =
        session.captureMode && session.pvoLanguageSources.has(component.id);
      const interactive =
        custom ||
        (session.captureMode
          ? component.kind !== "tooltip"
          : ["card", "choice", "form"].includes(component.kind));
      position.className = `component-position${interactive ? " interactive" : ""}${session.captureMode ? " capture-position" : ""}`;
      position.dataset.componentId = component.id;
      position.dataset.componentKind = component.kind;
      if (custom)
        position.classList.add("code-position", `code-${component.kind}`);
      if (session.captureMode) {
        if (sceneLayers)
          position.style.zIndex = String(
            order.indexOf(`component:${component.id}`) * 2 + 2,
          );
        position.dataset.layerId = `component:${component.id}`;
        position.dataset.authoredMotion = String(
          Boolean(
            Object.keys(component.restyle_capture?.animation?.tracks || {})
              .length,
          ),
        );
        position.dataset.belowVideo = String(
          Boolean(
            sceneLayers &&
            order.indexOf(`component:${component.id}`) < order.indexOf("video"),
          ),
        );
      } else {
        position.style.left = `${Number(presentation.x || 0) * 100}%`;
        position.style.top = `${Number(presentation.y || 0) * 100}%`;
        position.style.width = `${Number(presentation.width || 1) * 100}%`;
        position.style.height = `${Number(presentation.height || 1) * 100}%`;
        position.style.transform =
          "translate(var(--component-lift-x, 0px), var(--component-lift-y, 0px)) scale(var(--component-lift-scale, 1))";
      }
      refs.overlay.append(position);
      if (custom) {
        const source = session.pvoLanguageSources.get(component.id);
        const mounted = mountCustomComponent(position, {
          ...source,
          state:
            component.kind === "tooltip"
              ? (session.actionRuntime?.state ?? {})
              : undefined,
          componentId: component.id,
          font: component.restyle_capture?.font,
          interactive: true,
          ...(typeof session.onDiagnostic === "function"
            ? {
                onDiagnostic: (event) => {
                  if (event.type.startsWith("component."))
                    observeDiagnostic(session.onDiagnostic, {
                      type: event.type,
                      componentId: component.id,
                      reason: event.reason,
                    });
                },
              }
            : {}),
          onAction: (action) => {
            if (
              position.isConnected &&
              session.mountedCustom.get(component.id) === mounted
            )
              return adapters.handleCustomAction(component, action);
            return undefined;
          },
          onError: (error) =>
            adapters.setStatus(
              `PVO · ${String(error?.message || error)}`,
              true,
            ),
        });
        session.mountedCustom.set(component.id, mounted);
        mounted.setPending(session.pendingComponents.has(component.id));
      } else {
        const view = document.createElement("pvo-component-view");
        const response = session.capturedResponses.get(component.id);
        const selected =
          (component.kind === "choice" || component.kind === "card") && response
            ? response.index
            : undefined;
        const displayed = componentWithRuntimeState(
          component,
          session.actionRuntime?.state,
        );
        view.update(displayed, selected, session.captureMode, 1);
        view.setPending?.(session.pendingComponents.has(component.id));
        position.append(view);
      }
      const motion = session.captureMode
        ? createComponentMotion(position, component, {
            manifest: session.manifest,
            elapsedTime: adapters.elapsedTime,
          })
        : null;
      const entry = { position, motion };
      entries.set(component.id, entry);
      if (services)
        entry.recovery = mountServiceRecovery({
          position,
          surface: refs.frame,
          entry: session.serviceConnections.get(component.id),
          services,
          isCurrent: () =>
            position.isConnected &&
            entries.get(component.id)?.position === position,
          recover: () => adapters.recoverServiceSubmission(component.id),
          setStatus: adapters.setStatus,
          onLayout: () => adapters.updateLayout?.(),
          onReceipt: (receipt) => {
            const connection = session.serviceConnections.get(component.id);
            const action = componentAction(component, connection.index);
            if (action?.into && session.actionRuntime)
              session.actionRuntime.setState(action.into, receipt, {
                componentId: component.id,
              });
          },
        });
    });
  }

  function setComponentPending(componentId, pending) {
    session.mountedCustom.get(componentId)?.setPending(pending);
    refs.overlay.querySelectorAll("pvo-component-view").forEach((view) => {
      if (view.componentId === componentId) view.setPending?.(pending);
    });
  }

  /** Refresh one answered/pending control without replacing unrelated live form DOM. */
  function updateComponentResponse(componentId) {
    const component = session.manifest?.components?.find(
      (item) => item.id === componentId,
    );
    if (!component) return;
    void entries.get(componentId)?.recovery?.refresh();
    session.mountedCustom
      .get(componentId)
      ?.setPending(session.pendingComponents.has(componentId));
    refs.overlay.querySelectorAll("pvo-component-view").forEach((view) => {
      if (view.componentId !== componentId) return;
      const response = session.capturedResponses.get(componentId);
      const selected =
        (component.kind === "choice" || component.kind === "card") && response
          ? response.index
          : undefined;
      view.update(
        componentWithRuntimeState(component, session.actionRuntime?.state),
        selected,
        session.captureMode,
        1,
      );
      view.setPending?.(session.pendingComponents.has(componentId));
    });
  }

  /** Refresh visible Notes without rebuilding unrelated interactive component DOM. */
  function updateRuntimeState(state = {}) {
    const components = new Map(
      (session.manifest?.components || []).map((component) => [
        component.id,
        component,
      ]),
    );
    session.mountedCustom.forEach((mounted, componentId) => {
      if (components.get(componentId)?.kind === "tooltip")
        mounted.update({ state });
    });
    refs.overlay.querySelectorAll("pvo-component-view").forEach((view) => {
      const component = components.get(view.componentId);
      if (component?.kind !== "tooltip") return;
      view.update(
        componentWithRuntimeState(component, state),
        undefined,
        session.captureMode,
        1,
      );
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
