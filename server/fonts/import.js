import { validateFontAsset, MAX_FONT_BYTES } from "../../packages/pvo-fonts/index.js";
import { HttpError } from "../http.js";
import { publicHttpsUrl } from "../web/publicAddress.js";
import { readPublicResource } from "../web/publicFetch.js";
import { challengePage, htmlText } from "../web/htmlText.js";

function parseImport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["family", "url", "licenseUrl"].includes(key))
    || typeof input.family !== "string" || !/^[\p{L}\p{N} ._-]{1,100}$/u.test(input.family) || !input.family.trim())
    throw new HttpError(400, "Provide a font name, public font file and licence URL.");
  return { family: input.family.trim(), url: publicHttpsUrl(input.url).href, licenseUrl: publicHttpsUrl(input.licenseUrl).href };
}

function fontFormat(bytes) {
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const format = { wOF2: "woff2", wOFF: "woff", "\x00\x01\x00\x00": "ttf", OTTO: "otf" }[signature];
  if (!format) throw new HttpError(422, "This link did not return a WOFF2, WOFF, TTF or OTF font.");
  return format;
}

function encodedFont(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function identity(family, bytes) {
  const name = new TextEncoder().encode(`${family}\0`);
  const content = new Uint8Array(name.length + bytes.length);
  content.set(name);
  content.set(bytes, name.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", content));
  return `web-${[...hash.subarray(0, 12)].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Import the actual public bytes and supplied licence; this does not certify usage rights. */
export async function importFont(input, options = {}) {
  const request = parseImport(input);
  const resource = await readPublicResource(request.url, { ...options, maxBytes: MAX_FONT_BYTES });
  const format = fontFormat(resource.bytes);
  const licence = await readPublicResource(request.licenseUrl, { ...options, maxBytes: 128 * 1024 });
  if (!["text/html", "application/xhtml+xml", "text/plain", "text/markdown"].includes(licence.contentType))
    throw new HttpError(422, "The licence URL must return readable licence text.");
  const source = new TextDecoder().decode(licence.bytes);
  if (challengePage(source)) throw new HttpError(422, "The licence page could not be read without a browser challenge.");
  const licenseText = (licence.contentType.includes("html") ? htmlText(source) : source).trim();
  if (!licenseText || licenseText.length > 30000)
    throw new HttpError(422, "The licence text is missing or too long to save.");
  options.signal?.throwIfAborted();
  const id = await identity(request.family, resource.bytes);
  try {
    return validateFontAsset({ id, family: request.family, sourceUrl: resource.url,
      licenseUrl: licence.url, licenseText,
      faces: [{ dataUrl: `data:font/${format};base64,${encodedFont(resource.bytes)}`, weight: "400", style: "normal" }],
    });
  } catch {
    throw new HttpError(422, "The downloaded font file is incomplete or invalid.");
  }
}
