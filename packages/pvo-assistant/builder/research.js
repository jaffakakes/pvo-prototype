import {
  object,
  text,
  choice,
  list,
  requireTask,
  boundedJson,
} from "../tasks/validation.js";
import {
  parseResearchEvidence,
  parseResearchEvidenceResult,
  researchEvidenceDefinition,
} from "./researchEvidence.js";

export const BUILDER_RESEARCH_KINDS = Object.freeze([
  "web_search",
  "web_read",
  "web_evidence",
]);
export const BUILDER_RESEARCH_LIMITS = Object.freeze({
  queryBytes: 200,
  urlBytes: 2048,
  resultBytes: 48 * 1024,
  textBytes: 16000,
});

function url(value) {
  text(value, BUILDER_RESEARCH_LIMITS.urlBytes, "Public page URL");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid public page URL.");
  }
  requireTask(
    parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
    "Research requires an HTTPS page without credentials or a fragment.",
  );
}
export function parseBuilderResearch(value) {
  const kind = value && Object.getOwnPropertyDescriptor(value, "kind")?.value;
  choice(kind, BUILDER_RESEARCH_KINDS, "Public research kind");
  if (kind === "web_evidence") return parseResearchEvidence(value);
  object(
    value,
    ["kind", kind === "web_search" ? "query" : "url"],
    "Public research",
  );
  if (kind === "web_search") {
    text(
      value.query,
      BUILDER_RESEARCH_LIMITS.queryBytes,
      "Public search query",
    );
    requireTask(value.query.trim() === value.query, "Search must be trimmed.");
  } else url(value.url);
  return structuredClone(value);
}
export function serializeBuilderResearch(value) {
  const tool = parseBuilderResearch(value);
  if (tool.kind === "web_evidence") return JSON.stringify(tool);
  return JSON.stringify(
    tool.kind === "web_search"
      ? { kind: tool.kind, query: tool.query }
      : { kind: tool.kind, url: tool.url },
  );
}
export function parseBuilderResearchResult(tool, value) {
  tool = parseBuilderResearch(tool);
  object(value, ["kind", "status", "result"], "Public research result");
  requireTask(
    value.kind === tool.kind,
    "Research result does not match the request.",
  );
  choice(
    value.status,
    ["completed", "unavailable", "unknown"],
    "Research status",
  );
  if (value.status !== "completed")
    requireTask(
      value.result === null,
      "Unavailable research cannot invent evidence.",
    );
  else if (tool.kind === "web_evidence")
    parseResearchEvidenceResult(tool, value.result);
  else {
    const result = value.result;
    const link = (value) => {
      object(value, ["title", "url"], "Source link");
      text(value.title, 1200, "Source title", true);
      url(value.url);
    };
    if (tool.kind === "web_search") {
      object(
        result,
        ["query", "results", "source", "retrievedAt"],
        "Search result",
      );
      requireTask(
        result.query === tool.query,
        "Search result belongs to another query.",
      );
      text(result.source, 100, "Search source");
      list(result.results, 10, "Search sources");
      for (const item of result.results) {
        object(item, ["title", "url", "snippet"], "Search source");
        link({ title: item.title, url: item.url });
        text(item.snippet, 4800, "Source snippet", true);
      }
    } else {
      object(
        result,
        ["url", "title", "text", "links", "retrievedAt", "truncated"],
        "Page result",
      );
      url(result.url);
      text(result.title, 1200, "Page title", true);
      text(result.text, BUILDER_RESEARCH_LIMITS.textBytes, "Page text");
      list(result.links, 20, "Page links");
      result.links.forEach(link);
      requireTask(
        typeof result.truncated === "boolean",
        "Page truncation must be explicit.",
      );
    }
    text(result.retrievedAt, 50, "Research timestamp");
    requireTask(
      Number.isFinite(Date.parse(result.retrievedAt)),
      "Invalid research timestamp.",
    );
  }
  boundedJson(
    value,
    BUILDER_RESEARCH_LIMITS.resultBytes,
    "Public research result",
  );
  return structuredClone(value);
}
export function builderResearchDefinitions(available) {
  return BUILDER_RESEARCH_KINDS.filter((kind) => available.includes(kind)).map(
    (kind) =>
      kind === "web_evidence"
        ? researchEvidenceDefinition
        : {
            kind,
            description:
              kind === "web_search"
                ? "Search the public web for cited text evidence; no sign-in or private accounts."
                : "Read bounded public HTTPS page text and links; no page scripts, sign-in or credentials.",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["kind", kind === "web_search" ? "query" : "url"],
              properties: {
                kind: { const: kind },
                ...(kind === "web_search"
                  ? {
                      query: {
                        type: "string",
                        minLength: 1,
                        maxLength: BUILDER_RESEARCH_LIMITS.queryBytes,
                      },
                    }
                  : {
                      url: {
                        type: "string",
                        maxLength: BUILDER_RESEARCH_LIMITS.urlBytes,
                        pattern: "^https://",
                      },
                    }),
              },
            },
          },
  );
}
