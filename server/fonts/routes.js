import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { searchFontCatalogue } from "./catalogue.js";
import { downloadFont } from "./download.js";
import { importFont } from "./import.js";

export async function fontsRoute(request, options = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api/fonts/import") {
    if (request.method !== "POST") throw new HttpError(405, "Import a public font with POST.");
    checkOrigin(request, url.origin);
    const input = await readJson(request, 8192);
    return json(await importFont(input, { ...options, signal: request.signal }));
  }
  if (request.method !== "GET") throw new HttpError(405, "Font browsing uses GET.");
  if (url.pathname === "/api/fonts/search") {
    const query = url.searchParams.get("q") ?? "";
    if (query.length > 100) throw new HttpError(400, "Use a shorter font search.");
    return json({ fonts: await searchFontCatalogue(query) }, 200, { "Cache-Control": "public, max-age=3600" });
  }
  if (url.pathname === "/api/fonts/download") {
    const id = url.searchParams.get("id") ?? "";
    if (!/^google-[a-z0-9-]{1,100}$/.test(id)) throw new HttpError(400, "Choose a font from the catalogue.");
    return json(await downloadFont(id, { signal: request.signal }), 200, { "Cache-Control": "public, max-age=86400" });
  }
  throw new HttpError(404, "Font tool not found.");
}
