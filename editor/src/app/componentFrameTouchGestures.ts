import { installTouchGesturePolicy } from "./installTouchGesturePolicy";

function isRenderFrame(frame: HTMLIFrameElement) {
  // The scriptless renderer is accessible; the separate opaque runtime is not.
  return frame.title.startsWith("Component ") && frame.sandbox.length === 1
    && frame.sandbox.contains("allow-same-origin");
}

function watchRenderFrame(frame: HTMLIFrameElement) {
  let removeDocumentPolicy: (() => void) | undefined;
  const apply = () => {
    removeDocumentPolicy?.();
    removeDocumentPolicy = undefined;
    if (!isRenderFrame(frame)) return;

    let document: Document | null;
    try { document = frame.contentDocument; }
    catch { return; } // A navigated or newly opaque frame is outside our scope.
    if (!document?.head) return;

    const style = document.createElement("style");
    style.dataset.editorTouchGestures = "true";
    style.textContent = "html,body{touch-action:pan-x pan-y}";
    document.head.append(style);
    const removeListeners = installTouchGesturePolicy(document);
    removeDocumentPolicy = () => {
      removeListeners();
      style.remove();
    };
  };

  frame.addEventListener("load", apply);
  apply();
  return () => {
    frame.removeEventListener("load", apply);
    removeDocumentPolicy?.();
  };
}

/** Frame documents do not bubble touch events into the editor document. */
export function installComponentFrameTouchGestures(app: HTMLElement) {
  const frames = new Map<HTMLIFrameElement, () => void>();
  const reconcile = () => {
    const current = new Set(Array.from(app.querySelectorAll<HTMLIFrameElement>(".compCustomRuntime iframe"))
      .filter(isRenderFrame));
    for (const [frame, remove] of frames) {
      if (!current.has(frame)) {
        remove();
        frames.delete(frame);
      }
    }
    for (const frame of current) {
      if (!frames.has(frame)) frames.set(frame, watchRenderFrame(frame));
    }
  };

  const observer = new MutationObserver(reconcile);
  observer.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["sandbox", "title"],
  });
  reconcile();
  return () => {
    observer.disconnect();
    for (const remove of frames.values()) remove();
    frames.clear();
  };
}
