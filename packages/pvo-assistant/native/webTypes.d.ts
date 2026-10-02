export type FontSummary = { id: string; family: string };
export type WebObservationRequest =
  | { kind: "web_search"; query: string }
  | { kind: "web_read"; url: string }
  | { kind: "font_catalogue"; query: string }
  | { kind: "saved_fonts" }
  | { kind: "font_import"; family: string; url: string; licenseUrl: string };
export type WebObservation =
  | { kind: "web_search"; query: string; results: { title: string; url: string; snippet: string }[]; source: string; retrievedAt: string }
  | { kind: "web_read"; url: string; title: string; text: string; links: { title: string; url: string }[]; retrievedAt: string; truncated: boolean }
  | { kind: "font_catalogue"; query: string; fonts: (FontSummary & { category: string })[] }
  | { kind: "saved_fonts"; fonts: (FontSummary & { sourceUrl: string })[] }
  | { kind: "font_import"; font: FontSummary; sourceUrl: string; licenseUrl: string }
  | { kind: "web_unavailable"; requestedKind: WebObservationRequest["kind"]; message: string };
