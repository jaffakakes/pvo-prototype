import { createFontScope, fontFamily } from "../pvo-fonts/index.js";
import { sanitizeMarkup, sanitizeCss } from "./sanitize.js";
import { setRenderedFormPending } from "./form-feedback.js";

export function createRenderer(renderFrame, renderShell, report, setHandlers, onFit) {
  let fontScope = null;
  let activeFont = null;
  let disposed = false;

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
    onFit?.(scale);
  }

  function render(sources, options) {
    const doc = renderFrame.contentDocument;
    const root = doc?.getElementById("pvo-root");
    if (!root) return report("Component renderer is unavailable.");
    try {
      const safe = sanitizeMarkup(sources.html, sources.fields, options.state, report);
      setHandlers(safe.handlers);
      root.replaceChildren(doc.importNode(safe.fragment, true));
      let style = doc.getElementById("pvo-custom-style");
      if (!style) {
        style = doc.createElement("style");
        style.id = "pvo-custom-style";
        doc.head.append(style);
      }
      style.textContent = sanitizeCss(sources.css);
      let fontStyle = doc.getElementById("pvo-host-font");
      if (!fontStyle) {
        fontStyle = doc.createElement("style");
        fontStyle.id = "pvo-host-font";
        doc.head.append(fontStyle);
      }
      if (activeFont !== options.font) {
        fontScope?.dispose();
        fontScope = options.font ? createFontScope(doc) : null;
        activeFont = options.font;
        fontStyle.textContent = activeFont ? `#pvo-root,#pvo-root *{font-family:"${fontFamily(activeFont)}"!important}` : "";
        const loading = fontScope;
        if (loading) void loading.load(activeFont).then(() => {
          if (!disposed && loading === fontScope) fit(options);
        }).catch(error => { if (!disposed && loading === fontScope) report(error); });
      }
      setRenderedFormPending(root, options.pending);
      fit(options);
    } catch (error) {
      report(error);
    }
  }

  return { fit, render, dispose() { disposed = true; fontScope?.dispose(); fontScope = null; } };
}
