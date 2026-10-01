import { create } from "zustand";
import { layerOrder } from "../../../domain/layers/order";
import { useCapture } from "../../../state/captureStore";
import { showDebugFeedback } from "../../try-debugger/uiStore";

export const useDebugLocate = create<{ componentId: string | null }>(() => ({ componentId: null }));
let locateTimer: ReturnType<typeof setTimeout> | undefined;

export function clearDebugLocate() {
  clearTimeout(locateTimer);
  locateTimer = undefined;
  useDebugLocate.setState({ componentId: null });
}

/** Highlight only a visible preview layer, never its timeline bar. Does not seek. */
export function locateDebugComponent(componentId: string) {
  clearDebugLocate();
  const order = layerOrder(useCapture.getState());
  const aboveVideo = order.indexOf(`component:${componentId}`) > order.indexOf("video");
  const layer = [...document.querySelectorAll<HTMLElement>("[data-preview-component]")]
    .find(element => element.dataset.previewComponent === componentId);
  const rect = layer?.getBoundingClientRect();
  if (!aboveVideo || !rect || rect.width <= 0 || rect.height <= 0 || !layer?.checkVisibility()) {
    showDebugFeedback("Not on screen now. Locate does not move the video.");
    return;
  }
  useDebugLocate.setState({ componentId });
  locateTimer = setTimeout(clearDebugLocate, 2400);
}
