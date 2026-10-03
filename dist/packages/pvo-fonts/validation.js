/** Downloaded fonts are immutable data. No authored CSS or remote font URLs enter renderers. */
export const MAX_FONT_BYTES = 1024 * 1024;
export const MAX_FONT_FACES = 32;
const DATA_FONT = /^data:font\/(woff2|woff|ttf|otf);base64,/;
const cached = new WeakMap();

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
}
function url(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Font attribution URL is invalid.");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Font attribution must use HTTPS.");
  return value;
}
function weight(value) {
  if (typeof value !== "string" || !/^\d{1,4}(?: \d{1,4})?$/.test(value)) throw new Error("Font weight is invalid.");
  const parts = value.split(" ").map(Number);
  if (parts.some(item => item < 1 || item > 1000) || parts.length === 2 && parts[0] > parts[1]) throw new Error("Font weight is invalid.");
  return value;
}
function unicodeRange(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 3000 || !/^U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?(?:,\s*U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i.test(value)) throw new Error("Font character range is invalid.");
  return value;
}
export function fontBytes(dataUrl) {
  const prefix = typeof dataUrl === "string" ? DATA_FONT.exec(dataUrl) : null;
  if (!prefix) throw new Error("Only embedded WOFF2, WOFF, TTF and OTF fonts are supported.");
  const encoded = dataUrl.slice(prefix[0].length);
  if (encoded.length > Math.ceil(MAX_FONT_BYTES / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Font data is invalid or too large.");
  const binary = atob(encoded);
  const format = prefix[1];
  const minimum = format === "woff2" ? 48 : format === "woff" ? 44 : 12;
  const magic = { woff2: "wOF2", woff: "wOFF", ttf: "\x00\x01\x00\x00", otf: "OTTO" }[format];
  if (binary.length < minimum || binary.slice(0, 4) !== magic) throw new Error("Font format does not match its bytes.");
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const header = new DataView(bytes.buffer);
  if (format === "woff2" || format === "woff") {
    const tables = header.getUint16(12);
    if (header.getUint32(8) !== bytes.length || tables < 1 || tables > 256 || header.getUint16(14) !== 0) throw new Error("Font header is invalid.");
    if (header.getUint32(16) > 16 * MAX_FONT_BYTES) throw new Error("Expanded font is too large.");
    if (format === "woff" && minimum + tables * 20 > bytes.length) throw new Error("Font tables are incomplete.");
  } else {
    const tables = header.getUint16(4);
    if (tables < 1 || tables > 256 || 12 + tables * 16 > bytes.length) throw new Error("Font tables are invalid.");
    for (let index = 0; index < tables; index++) {
      const offset = header.getUint32(12 + index * 16 + 8);
      const length = header.getUint32(12 + index * 16 + 12);
      if (offset < 12 + tables * 16 || offset + length > bytes.length) throw new Error("Font table bytes are incomplete.");
    }
  }
  return bytes;
}

export function validateFontAsset(input) {
  record(input, "Font");
  if (cached.has(input)) return cached.get(input);
  if (typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(input.id)) throw new Error("Font ID is invalid.");
  if (typeof input.family !== "string" || input.family.length < 1 || input.family.length > 100 || !/^[\p{L}\p{N} ._-]+$/u.test(input.family)) throw new Error("Font family is invalid.");
  if (typeof input.licenseText !== "string" || input.licenseText.trim().length < 1 || input.licenseText.length > 30000) throw new Error("Font licence text is missing or too large.");
  if (!Array.isArray(input.faces) || !input.faces.length || input.faces.length > MAX_FONT_FACES) throw new Error("Font faces are invalid.");
  let size = 0;
  const faces = input.faces.map(face => {
    record(face, "Font face");
    size += fontBytes(face.dataUrl).byteLength;
    if (size > MAX_FONT_BYTES) throw new Error("Font is larger than 1 MB.");
    if (face.style !== "normal" && face.style !== "italic") throw new Error("Font style is invalid.");
    const range = unicodeRange(face.unicodeRange);
    return Object.freeze({ dataUrl: face.dataUrl, weight: weight(face.weight), style: face.style, ...(range === undefined ? {} : { unicodeRange: range }) });
  });
  const font = Object.freeze({ id: input.id, family: input.family, sourceUrl: url(input.sourceUrl), licenseUrl: url(input.licenseUrl), licenseText: input.licenseText, faces: Object.freeze(faces) });
  cached.set(font, font);
  return font;
}

const identities = new WeakMap();
export function fontFamily(input) {
  if (identities.has(input)) return identities.get(input);
  const font = validateFontAsset(input);
  // Include face contents so re-downloaded versions use distinct internal family names.
  let hash = 2166136261;
  for (const face of font.faces) {
    const value = `${face.weight}:${face.style}:${face.unicodeRange ?? ""}:${face.dataUrl}`;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  const family = `pvo-${font.id}-${(hash >>> 0).toString(16)}`;
  identities.set(font, family);
  if (Object.isFrozen(input)) identities.set(input, family);
  return family;
}

export function fontFaceCss(input) {
  const font = validateFontAsset(input);
  const family = fontFamily(font);
  return font.faces.map(face => `@font-face{font-family:"${family}";src:url("${face.dataUrl}") format("${({ woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" })[DATA_FONT.exec(face.dataUrl)[1]]}");font-weight:${face.weight};font-style:${face.style};font-display:swap;${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ""}}`).join("\n");
}
