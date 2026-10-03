import { HttpError } from "../http.js";
import { fontText } from "./upstream.js";
import { matchFontCatalogue } from "./catalogueSearch.js";

const CATALOGUE_URL = "https://fonts.google.com/metadata/fonts";
let cached;
let pending;

export function fontId(family) {
  return `google-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function parseCatalogue(text) {
  const body = JSON.parse(text.slice(text.indexOf("{")));
  if (!Array.isArray(body.familyMetadataList)) throw new HttpError(502, "The font catalogue could not be read.");
  return body.familyMetadataList.filter(item => item.isOpenSource === true
    && typeof item.family === "string" && /^[A-Za-z0-9][A-Za-z0-9 .-]{0,99}$/.test(item.family)
    && item.fonts && typeof item.fonts === "object").map(item => ({
    id: fontId(item.family), family: item.family, category: String(item.category ?? "").slice(0, 60),
    popularity: Number(item.popularity) || 10000,
    weights: Object.keys(item.fonts).filter(weight => /^\d{3}$/.test(weight)).map(Number),
    weightAxis: item.axes?.find(axis => axis.tag === "wght"),
  }));
}

export async function fontCatalogue(options = {}) {
  if (options.fetch) return parseCatalogue(await fontText(CATALOGUE_URL, 6_000_000, options));
  if (cached && cached.expires > Date.now()) return cached.items;
  pending ??= fontText(CATALOGUE_URL, 6_000_000).then(text => {
    const items = parseCatalogue(text);
    cached = { items, expires: Date.now() + 86_400_000 };
    return items;
  }).finally(() => { pending = undefined; });
  return pending;
}

export async function searchFontCatalogue(query, options = {}) {
  return matchFontCatalogue(await fontCatalogue(options), query)
    .map(({ id, family, category }) => ({ id, family, category }));
}
