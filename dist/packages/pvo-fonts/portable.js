import { MAX_FONT_BYTES, fontFamily, validateFontAsset } from "./validation.js";

function fontSlots(manifest) {
  const slots = [];
  for (const component of manifest.components ?? []) {
    if (component.restyle_capture?.font !== undefined) slots.push([component.restyle_capture, "font"]);
  }
  for (const scene of Object.values(manifest.restyle_capture?.scene_layers ?? {})) {
    for (const text of scene.texts ?? []) {
      if (text.style?.fontAsset !== undefined) slots.push([text.style, "fontAsset"]);
    }
  }
  return slots;
}

/** Keep one font payload per unique asset out of the bounded JSON manifest. */
export function packageManifestFonts(manifest) {
  const result = structuredClone(manifest);
  const assets = new Map();
  for (const [owner, key] of fontSlots(result)) {
    const font = validateFontAsset(owner[key]);
    const id = `fonts/${fontFamily(font)}.json`;
    if (!assets.has(id)) assets.set(id, { id, name: id, type: "application/vnd.pvo.font+json", blob: new Blob([JSON.stringify(font)], { type: "application/vnd.pvo.font+json" }) });
    owner[key] = { asset_id: id };
  }
  return { manifest: result, assets: [...assets.values()] };
}

/** Resolve only packaged bytes; a PVO file cannot ask the viewer to download fonts. */
export async function restoreManifestFonts(decoded) {
  const assets = new Map(decoded.assets.map(asset => [asset.id, asset]));
  const pending = new Map();
  const fonts = [];
  for (const [owner, key] of fontSlots(decoded.manifest)) {
    const reference = owner[key];
    if (!reference || typeof reference !== "object" || Array.isArray(reference) || Object.keys(reference).length !== 1 || typeof reference.asset_id !== "string" || !/^fonts\/pvo-[a-z0-9-]+\.json$/.test(reference.asset_id)) throw new Error("Packaged font reference is invalid.");
    if (!pending.has(reference.asset_id)) {
      const asset = assets.get(reference.asset_id);
      if (!asset || asset.type !== "application/vnd.pvo.font+json" || asset.blob.size > Math.ceil(MAX_FONT_BYTES * 4 / 3) + 256 * 1024) throw new Error("Packaged font is missing or too large.");
      pending.set(reference.asset_id, asset.blob.text().then(text => validateFontAsset(JSON.parse(text))));
    }
    const font = await pending.get(reference.asset_id);
    if (`fonts/${fontFamily(font)}.json` !== reference.asset_id) throw new Error("Packaged font identity does not match its contents.");
    owner[key] = font;
    if (!fonts.includes(font)) fonts.push(font);
  }
  return fonts;
}
