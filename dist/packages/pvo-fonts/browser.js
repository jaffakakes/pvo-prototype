import { fontBytes, fontFamily, validateFontAsset } from "./validation.js";

/** Each owner releases its FontFace objects; binary sources require no network or CSP permission. */
export function createFontScope(doc = document) {
  const entries = new Map();
  let disposed = false;
  return {
    async load(input) {
      if (disposed) return Promise.reject(new Error("Font scope is closed."));
      const font = validateFontAsset(input);
      const family = fontFamily(font);
      if (entries.has(family)) return entries.get(family).ready;
      const Font = doc.defaultView?.FontFace ?? globalThis.FontFace;
      const faces = font.faces.map(face => new Font(family, fontBytes(face.dataUrl), {
        weight: face.weight, style: face.style, ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      }));
      const ready = Promise.all(faces.map(face => face.load())).then(() => {
        if (!disposed) faces.forEach(face => doc.fonts.add(face));
      }).catch(error => {
        entries.delete(family);
        faces.forEach(face => doc.fonts.delete(face));
        throw new Error(`Could not load font ${font.family}: ${error.message}`);
      });
      entries.set(family, { faces, ready });
      return ready;
    },
    dispose() {
      disposed = true;
      for (const { faces } of entries.values()) faces.forEach(face => doc.fonts.delete(face));
      entries.clear();
    },
  };
}

// Library previews share a document-lifetime cache. Project/export/render owners use scopes instead.
const libraries = new WeakMap();
export function loadFontAsset(input, doc = document) {
  if (!libraries.has(doc)) libraries.set(doc, createFontScope(doc));
  return libraries.get(doc).load(input);
}
