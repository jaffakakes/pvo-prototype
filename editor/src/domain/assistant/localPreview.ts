import type { PvoLanguageRule, PvoLanguageStructure } from "../../../../packages/pvo-language/index.js";
import type { AssistantDraft, AssistantRequest } from "./model";
import { localContentChange, type LocalContent } from "./localContent";
import { assistantHeading, localStyleRules } from "./localStyle";

export class UnsupportedLocalPreviewRequest extends Error {
  constructor() {
    super("Local preview supports colours, text size, corners, wording, Card buttons and approved playback actions.");
    this.name = "UnsupportedLocalPreviewRequest";
  }
}

function clauses(prompt: string) {
  // Quoted wording may contain commas or “and”; those belong to the component text.
  const pieces = prompt.match(/"[^"]*"|“[^”]*”|'[^']*'|[^"“']+/g) ?? [];
  const result = [""];
  for (const piece of pieces) {
    if (/^["“']/.test(piece)) { result[result.length - 1] += piece; continue; }
    const parts = piece.split(/\s+and\s+|\s*;\s*|\s*·\s*|,\s*/i);
    result[result.length - 1] += parts[0];
    result.push(...parts.slice(1));
  }
  return result.map(value => value.trim()).filter(Boolean);
}

/** Deterministic phrases, with unmapped clauses kept visible in the review notes. */
export function localPreviewDraft(request: AssistantRequest, structure: PvoLanguageStructure, rules: PvoLanguageRule[] = []): AssistantDraft & { skipped: string[] } {
  let current: LocalContent = { source: { ...request.source }, structure, rules };
  const skipped: string[] = [];
  let mapped = 0;
  for (const clause of clauses(request.prompt)) {
    const content = localContentChange(clause, current);
    if (content) { current = content; mapped++; continue; }
    const style = localStyleRules(clause, current.structure, current.source.style);
    if (style) {
      const addition = style.join("\n");
      const before = current.source.style.trimEnd();
      current.source.style = before.endsWith(addition) ? current.source.style : `${before}${before ? "\n\n" : ""}${addition}`;
      mapped++;
    } else skipped.push(`Skipped: ${clause.slice(0, 100)}.`);
  }
  if (!mapped) throw new UnsupportedLocalPreviewRequest();
  return {
    source: current.source, summary: "Preview the requested component changes.", tags: [], skipped,
    followUps: ["Softer colours", `Larger ${assistantHeading(current.structure).label}`, "Bolder"],
  };
}
