const text = maxLength => ({ type: "string", maxLength });
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, maxItems) => ({ type: "array", items, maxItems });
const tool = (kind, properties) => object({ kind: { const: kind }, ...properties });
const url = { ...text(2048), pattern: "^https://" };
const query = { ...text(200), minLength: 1 };
const font = object({ id: text(128), family: text(100) });
const link = object({ title: text(300), url });

export const webObservationRequests = [
  tool("web_search", { query }),
  tool("web_read", { url }),
  tool("font_catalogue", { query: text(100) }),
  tool("saved_fonts", {}),
  tool("font_import", { family: { ...text(100), minLength: 1 }, url, licenseUrl: url }),
];

export const webObservations = [
  tool("web_search", { query, results: list(object({ title: text(300), url, snippet: text(1200) }), 10),
    source: text(100), retrievedAt: text(50) }),
  tool("web_read", { url, title: text(300), text: text(16000), links: list(link, 20),
    retrievedAt: text(50), truncated: { type: "boolean" } }),
  tool("font_catalogue", { query: text(100), fonts: list(object({ ...font.properties, category: text(60) }), 24) }),
  tool("saved_fonts", { fonts: list(object({ ...font.properties, sourceUrl: url }), 40) }),
  tool("font_import", { font, sourceUrl: url, licenseUrl: url }),
  tool("web_unavailable", { requestedKind: { enum: webObservationRequests.map(item => item.properties.kind.const) }, message: text(500) }),
];

export const fontSummarySchema = font;
