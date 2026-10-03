import { validateFontAsset, type AppliedFont } from "../../../../packages/pvo-fonts/index.js";

export type WebFont = { id: string; family: string; category: string };
export type FontSource = { title: string; url: string; snippet: string };
export type FontImport = { family: string; url: string; licenseUrl: string };

async function requestFonts(path: string, signal?: AbortSignal, body?: FontImport): Promise<unknown> {
  const timeout = AbortSignal.timeout(60000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(path, {
      signal: combined, credentials: "same-origin", redirect: "error",
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 413
      ? "This font is too large to save. Choose another."
      : body ? "Couldn't import this font. Check its file and licence URLs."
        : "Couldn't complete this search or download. Try again.");
    return await response.json();
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw new Error("Font download timed out. Try again.");
    throw error instanceof Error ? error : new Error("Couldn't load fonts.");
  }
}

export async function searchGoogleFonts(query: string, signal?: AbortSignal): Promise<WebFont[]> {
  if (query.trim().length > 100) throw new Error("Use 100 characters or fewer for Google Fonts.");
  const value = await requestFonts(`/api/fonts/search?q=${encodeURIComponent(query.trim())}`, signal);
  if (!value || typeof value !== "object" || !("fonts" in value) || !Array.isArray(value.fonts)
    || value.fonts.length > 24) throw new Error("The font catalogue could not be read.");
  return value.fonts.map((font: unknown) => {
    if (!font || typeof font !== "object" || !("id" in font) || !("family" in font) || !("category" in font)
      || typeof font.id !== "string" || !/^google-[a-z0-9-]{1,100}$/.test(font.id)
      || typeof font.family !== "string" || font.family.length > 100 || typeof font.category !== "string")
      throw new Error("The font catalogue returned an invalid font.");
    return { id: font.id, family: font.family, category: font.category.slice(0, 60) };
  });
}

export async function downloadWebFont(id: string, signal?: AbortSignal): Promise<AppliedFont> {
  if (!/^google-[a-z0-9-]{1,100}$/.test(id)) throw new Error("Choose a font from the web catalogue.");
  return validateFontAsset(await requestFonts(`/api/fonts/download?id=${encodeURIComponent(id)}`, signal));
}

function sourceUrl(value: unknown, maximum = 2048): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error("Use a valid HTTPS link.");
  let parsed: URL;
  try { parsed = new URL(value.trim()); }
  catch { throw new Error("Use a valid HTTPS link."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Use a valid HTTPS link.");
  return parsed.href;
}

export async function searchFontSources(query: string, signal?: AbortSignal): Promise<FontSource[]> {
  const search = query.trim();
  if (!search || search.length > 200) throw new Error("Enter a web search of up to 200 characters.");
  const value = await requestFonts(`/api/web/search?q=${encodeURIComponent(search)}`, signal);
  if (!value || typeof value !== "object" || !("results" in value) || !Array.isArray(value.results)
    || value.results.length > 10) throw new Error("The web search results could not be read.");
  return value.results.map((result: unknown) => {
    if (!result || typeof result !== "object" || !("title" in result) || !("url" in result) || !("snippet" in result)
      || typeof result.title !== "string" || !result.title.trim() || result.title.length > 300
      || typeof result.snippet !== "string" || result.snippet.length > 1200)
      throw new Error("The web search returned an invalid result.");
    return { title: result.title, url: sourceUrl(result.url), snippet: result.snippet };
  });
}

export function isFontFileUrl(url: string): boolean {
  try { return /\.(woff2?|ttf|otf)$/i.test(new URL(sourceUrl(url)).pathname); }
  catch { return false; }
}

export async function importFontUrl(input: FontImport, signal?: AbortSignal): Promise<AppliedFont> {
  const family = input.family.trim();
  if (!family || family.length > 100 || !/^[\p{L}\p{N} ._-]+$/u.test(family))
    throw new Error("Enter a font family name using letters, numbers, spaces, dots or dashes.");
  const body = { family, url: sourceUrl(input.url), licenseUrl: sourceUrl(input.licenseUrl) };
  return validateFontAsset(await requestFonts("/api/fonts/import", signal, body));
}
