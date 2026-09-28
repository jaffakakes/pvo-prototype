import { sanitizeMarkup, sanitizeCss } from "./sanitize.js";
import { setRenderedFormPending } from "./form-feedback.js";

export function createRenderer(renderFrame, renderShell, report, setHandlers) {
  function fit(options) {
    const doc = renderFrame.contentDocument;
    const root = doc?.getElementById("pvo-root");
    if (!root) return;
    const maxWidth = Math.max(
      40,
      Math.min(1000, Number(options.maxWidth) || 247),
    );
    const maxHeight = Math.max(
      20,
      Math.min(1000, Number(options.maxHeight) || 600),
    );
    renderFrame.style.width = `${maxWidth}px`;
    renderFrame.style.height = `${maxHeight}px`;
    const rect = root.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.min(maxWidth, Math.ceil(Math.max(rect.width, root.scrollWidth))),
    );
    const height = Math.max(
      1,
      Math.min(maxHeight, Math.ceil(Math.max(rect.height, root.scrollHeight))),
    );
    const scale = Math.max(0.1, Math.min(4, Number(options.scale) || 1));
    renderFrame.style.width = `${width}px`;
    renderFrame.style.height = `${height}px`;
    renderFrame.style.transform = `scale(${scale})`;
    renderShell.style.width = `${width * scale}px`;
    renderShell.style.height = `${height * scale}px`;
  }

  function render(sources, options) {
    const doc = renderFrame.contentDocument;
    const root = doc?.getElementById("pvo-root");
    if (!root) return report("Component renderer is unavailable.");
    try {
      const safe = sanitizeMarkup(sources.html, sources.fields, report);
      setHandlers(safe.handlers);
      root.replaceChildren(doc.importNode(safe.fragment, true));
      let style = doc.getElementById("pvo-custom-style");
      if (!style) {
        style = doc.createElement("style");
        style.id = "pvo-custom-style";
        doc.head.append(style);
      }
      style.textContent = sanitizeCss(sources.css);
      setRenderedFormPending(root, options.pending);
      fit(options);
    } catch (error) {
      report(error);
    }
  }

  return { fit, render };
}
