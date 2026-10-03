import { validateFontAsset } from "../../packages/pvo-fonts/index.js";
import { HttpError } from "../http.js";
import { fontCatalogue } from "./catalogue.js";
import { fontBytes, fontText } from "./upstream.js";

const MAX_BYTES = 1024 * 1024;

export function parseFontStylesheet(css) {
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, body]) => {
    const property = name => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
    const url = /url\((?:['"])?(https:\/\/[^)'"\s]+)(?:['"])?\)/.exec(property("src") ?? "")?.[1];
    if (!url) throw new HttpError(502, "The font provider did not supply a web font.");
    const parsed = new URL(url);
    if (parsed.origin !== "https://fonts.gstatic.com" || !/^\/s\/[A-Za-z0-9/_-]+\.woff2$/.test(parsed.pathname)
      || parsed.search || parsed.hash) throw new HttpError(502, "The font provider returned an invalid font link.");
    return { url, weight: property("font-weight") ?? "400", style: property("font-style") ?? "normal",
      ...(property("unicode-range") ? { unicodeRange: property("unicode-range") } : {}) };
  });
  if (!faces.length || faces.length > 32) throw new HttpError(413, "This font has too many files to save.");
  return faces;
}

function base64(bytes) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

async function fontLicense(family, options) {
  const folder = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [directory, file] of [["ofl", "OFL.txt"], ["apache", "LICENSE.txt"], ["ufl", "UFL.txt"]]) {
    options.signal?.throwIfAborted();
    const url = `https://raw.githubusercontent.com/google/fonts/main/${directory}/${folder}/${file}`;
    try {
      const text = await fontText(url, 30000, options);
      if (!/SIL OPEN FONT LICENSE|Apache License|UBUNTU FONT LICENCE/i.test(text)) continue;
      return { licenseUrl: `https://github.com/google/fonts/blob/main/${directory}/${folder}/${file}`, licenseText: text };
    } catch { options.signal?.throwIfAborted(); }
  }
  throw new HttpError(502, "Couldn't retrieve this font's licence. Choose another font.");
}

export async function downloadFont(id, options = {}) {
  const item = (await fontCatalogue(options)).find(font => font.id === id);
  if (!item) throw new HttpError(404, "That font is not in the web catalogue.");
  const axis = item.weightAxis;
  const weights = axis && Number.isFinite(axis.min) && Number.isFinite(axis.max)
    ? `${Math.max(100, axis.min)}..${Math.min(900, axis.max)}`
    : [...new Set([item.weights.includes(400) ? 400 : item.weights[0],
      item.weights.includes(700) ? 700 : item.weights[0]])].filter(Boolean).sort().join(";");
  const url = new URL("https://fonts.googleapis.com/css2");
  url.searchParams.set("family", `${item.family}${weights ? `:wght@${weights}` : ""}`);
  url.searchParams.set("display", "swap");
  const descriptors = parseFontStylesheet(await fontText(url.href, 100000, options));
  let total = 0;
  const files = new Map();
  const faces = [];
  for (const { url: fileUrl, ...face } of descriptors) {
    let dataUrl = files.get(fileUrl);
    if (!dataUrl) {
      const bytes = await fontBytes(fileUrl, MAX_BYTES - total, options);
      if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "wOF2")
        throw new HttpError(502, "The font provider returned an invalid font file.");
      total += bytes.length;
      dataUrl = `data:font/woff2;base64,${base64(bytes)}`;
      files.set(fileUrl, dataUrl);
    }
    faces.push({ ...face, dataUrl });
  }
  return validateFontAsset({ id: item.id, family: item.family, faces, ...await fontLicense(item.family, options),
    sourceUrl: `https://fonts.google.com/specimen/${encodeURIComponent(item.family)}`,
  });
}
