import { parseNativeObservation, type WebObservation, type WebObservationRequest, type NativeObservationRequest, type NativeOperation } from "../../../../packages/pvo-assistant/native/index.js";
import { validateFontAsset, type AppliedFont } from "../../../../packages/pvo-fonts/index.js";
import { searchGoogleFonts } from "../fonts/catalogue";

export const isWebObservationRequest = (request: NativeObservationRequest): request is WebObservationRequest =>
  ["web_search", "web_read", "font_catalogue", "saved_fonts", "font_import"].includes(request.kind);

type FontLibrary = { list(): Promise<AppliedFont[]>; save(font: AppliedFont): Promise<void> };

async function webRequest(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    credentials: "same-origin", redirect: "error", headers: { Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error("The web tool could not access that source. Try another public source.");
  return await response.json();
}

/** Website text is returned as bounded data, never interpreted as an editor command. */
export async function inspectWebTool(request: WebObservationRequest, signal: AbortSignal, library: FontLibrary): Promise<WebObservation> {
  signal.throwIfAborted();
  try {
    let result: unknown;
    if (request.kind === "web_search") {
      const data = await webRequest(`/api/web/search?q=${encodeURIComponent(request.query)}`, signal);
      result = { ...(data as object), kind: request.kind };
    } else if (request.kind === "web_read") {
      const data = await webRequest(`/api/web/read?url=${encodeURIComponent(request.url)}`, signal);
      result = { ...(data as object), kind: request.kind };
    } else if (request.kind === "font_catalogue") {
      result = { ...request, fonts: await searchGoogleFonts(request.query, signal) };
    } else if (request.kind === "saved_fonts") {
      result = { kind: request.kind, fonts: (await library.list()).map(({ id, family, sourceUrl }) => ({ id, family, sourceUrl })) };
    } else {
      const { kind: _kind, ...input } = request;
      const font = validateFontAsset(await webRequest("/api/fonts/import", signal, input));
      signal.throwIfAborted();
      await library.save(font);
      result = { kind: request.kind, font: { id: font.id, family: font.family }, sourceUrl: font.sourceUrl, licenseUrl: font.licenseUrl };
    }
    signal.throwIfAborted();
    return parseNativeObservation(result) as WebObservation;
  } catch {
    signal.throwIfAborted();
    return { kind: "web_unavailable", requestedKind: request.kind,
      message: "This source could not be accessed or validated. No project edit was applied by this tool. Use another public source; do not invent results." };
  }
}

export async function prepareAssistantFonts(operations: readonly NativeOperation[], signal: AbortSignal,
  obtain: (id: string, signal: AbortSignal) => Promise<AppliedFont>): Promise<Map<string, AppliedFont>> {
  const ids = new Set(operations.filter(operation => operation.kind === "font.apply")
    .map(operation => operation.fontId).filter((id): id is string => id !== null));
  const fonts = new Map<string, AppliedFont>();
  for (const id of ids) {
    signal.throwIfAborted();
    const font = validateFontAsset(await obtain(id, signal));
    if (font.id !== id) throw new Error("The downloaded font did not match the requested font.");
    fonts.set(id, font);
  }
  signal.throwIfAborted();
  return fonts;
}
