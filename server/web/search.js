import { HttpError } from "../http.js";
import { publicHttpsUrl } from "./publicAddress.js";
import { readPublicResource } from "./publicFetch.js";
import { challengePage, htmlAttribute, htmlText } from "./htmlText.js";

/** Parse actual result anchors only; challenges and changed markup fail explicitly. */
export function parseSearchResults(html) {
  if (challengePage(html)) throw new HttpError(503, "Web search requires a provider challenge. Try again later.");
  const results = [];
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  for (let index = 0; index < anchors.length; index++) {
    const [whole, attributes, label] = anchors[index];
    if (!htmlAttribute(attributes, "class")?.split(/\s+/).includes("result__a")) continue;
    let url;
    try {
      const href = htmlAttribute(attributes, "href");
      if (!href) continue;
      const link = new URL(href, "https://duckduckgo.com");
      url = publicHttpsUrl(link.hostname === "duckduckgo.com" && link.pathname === "/l/"
        ? link.searchParams.get("uddg") : link.href).href;
    } catch { continue; }
    if (results.some(result => result.url === url)) continue;
    const title = htmlText(label).slice(0, 300);
    if (!title) continue;
    const next = anchors.slice(index + 1).find(anchor => htmlAttribute(anchor[1], "class")?.split(/\s+/).includes("result__a"));
    const after = html.slice(anchors[index].index + whole.length,
      Math.min(next?.index ?? html.length, anchors[index].index + whole.length + 12000));
    const snippetMatch = /<(?:a|div|span)\b([^>]*\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*)>([\s\S]*?)<\/(?:a|div|span)\s*>/i.exec(after);
    results.push({ title, url, snippet: snippetMatch ? htmlText(snippetMatch[2]).slice(0, 1200) : "" });
    if (results.length === 10) break;
  }
  if (!results.length && !/no-results|no results found|no more results/i.test(html))
    throw new HttpError(502, "Web search returned an unreadable result. Try again later.");
  return results;
}

export async function searchWeb(query, options = {}) {
  if (typeof query !== "string" || !query.trim() || query.trim().length > 200)
    throw new HttpError(400, "Enter a search of 1–200 characters.");
  const clean = query.trim();
  const url = new URL("https://html.duckduckgo.com/html/");
  url.search = new URLSearchParams({ q: clean }).toString();
  const resource = await readPublicResource(url.href, { ...options, maxBytes: 1024 * 1024,
    allowedHosts: ["html.duckduckgo.com", "duckduckgo.com"] });
  if (resource.contentType !== "text/html") throw new HttpError(502, "Web search returned an unreadable result. Try again later.");
  const results = parseSearchResults(new TextDecoder().decode(resource.bytes));
  return { query: clean, results, source: "DuckDuckGo", retrievedAt: new Date().toISOString() };
}
