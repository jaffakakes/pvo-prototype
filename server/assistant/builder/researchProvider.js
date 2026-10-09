import {
  BUILDER_RESEARCH_LIMITS,
  builderResearchDefinitions,
  parseBuilderResearch,
  parseBuilderResearchResult,
} from "../../../packages/pvo-assistant/builder/index.js";
import { searchWeb } from "../../web/search.js";
import { readWebPage } from "../../web/read.js";

function truncate(value, maximum) {
  let text = "",
    bytes = 0;
  for (const char of value) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > maximum) break;
    text += char;
    bytes += size;
  }
  return text;
}

/** Public read-only adapter; never accepts account headers, provider keys or generated-code egress. */
export function publicResearch({ fetch: send = globalThis.fetch } = {}) {
  if (typeof send !== "function") return null;
  return {
    definitions: builderResearchDefinitions(["web_search", "web_read"]),
    async execute(value, signal) {
      const tool = parseBuilderResearch(value);
      if (!["web_search", "web_read"].includes(tool.kind))
        throw new Error("Evidence requires the saved task's source journal.");
      try {
        const options = { fetch: send, signal, timeoutMs: 10000 };
        const result =
          tool.kind === "web_search"
            ? await searchWeb(tool.query, options)
            : await readWebPage(tool.url, options);
        if (tool.kind === "web_read") {
          const text = truncate(result.text, BUILDER_RESEARCH_LIMITS.textBytes);
          result.truncated ||= text !== result.text;
          result.text = text;
        }
        return parseBuilderResearchResult(tool, {
          kind: tool.kind,
          status: "completed",
          result,
        });
      } catch {
        signal?.throwIfAborted();
        return parseBuilderResearchResult(tool, {
          kind: tool.kind,
          status: "unavailable",
          result: null,
        });
      }
    },
  };
}
