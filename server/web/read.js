import { HttpError } from "../http.js";
import { publicHttpsUrl } from "./publicAddress.js";
import { readPublicResource } from "./publicFetch.js";
import { challengePage, htmlAttribute, htmlText } from "./htmlText.js";

export function readablePage(resource) {
  if (!["text/html", "application/xhtml+xml", "text/plain", "text/markdown"].includes(resource.contentType))
    throw new HttpError(415, "This link is a download, not a readable web page.");
  const source = new TextDecoder().decode(resource.bytes);
  if (challengePage(source)) throw new HttpError(503, "This website requires a browser challenge and could not be read.");
  let title = new URL(resource.url).hostname;
  let text = source;
  const links = [];
  if (resource.contentType.includes("html")) {
    title = htmlText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)?.[1] ?? title).slice(0, 300);
    const content = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(source)?.[2]
      ?? /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(source)?.[1] ?? source;
    text = htmlText(content.replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " "));
    for (const match of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      const label = htmlText(match[2]).slice(0, 300);
      if (!label) continue;
      try {
        const href = htmlAttribute(match[1], "href");
        if (!href || href.startsWith("#")) continue;
        const url = publicHttpsUrl(new URL(href, resource.url).href).href;
        if (!links.some(link => link.url === url)) links.push({ title: label, url });
      } catch { /* Unsupported links remain text; they are never fetched. */ }
      if (links.length === 20) break;
    }
  }
  if (!text.trim()) throw new HttpError(422, "This page did not contain readable text.");
  return { url: resource.url, title, text: text.trim().slice(0, 16000), links,
    truncated: text.trim().length > 16000, retrievedAt: new Date().toISOString() };
}

export async function readWebPage(url, options = {}) {
  return readablePage(await readPublicResource(url, { ...options, maxBytes: 1024 * 1024 }));
}
