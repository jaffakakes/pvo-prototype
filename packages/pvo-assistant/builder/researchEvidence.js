import {
  object,
  text,
  list,
  choice,
  requireTask,
} from "../tasks/validation.js";
import { parseWorkspaceOperationId } from "../workspaces/index.js";

const assessmentFields = [
  "operation",
  "support",
  "excerpts",
  "accessRequirements",
  "uncertainty",
  "stillNeedsTesting",
];
const supportValues = ["documented", "not_documented", "unclear"];
const limits = { operation: 600, excerpt: 800, note: 600, entries: 6 };

function assessment(value) {
  text(value.operation, limits.operation, "Requested operation");
  choice(value.support, supportValues, "Documented support");
  for (const field of assessmentFields.slice(2)) {
    list(value[field], field === "excerpts" ? 3 : limits.entries, field);
    for (const item of value[field])
      text(item, field === "excerpts" ? limits.excerpt : limits.note, field);
  }
  requireTask(
    value.support !== "documented" || value.excerpts.length > 0,
    "Documented support requires a source excerpt.",
  );
  requireTask(
    value.support === "documented" || value.uncertainty.length > 0,
    "Unestablished support requires an explanation of uncertainty.",
  );
  requireTask(
    value.stillNeedsTesting.length > 0,
    "Source research must say what still needs testing.",
  );
  return Object.fromEntries(
    assessmentFields.map((key) => [key, structuredClone(value[key])]),
  );
}

/** Model interpretation only. The task adapter supplies the actual read and its provenance. */
export function parseResearchEvidence(value) {
  object(
    value,
    ["kind", "sourceOperationId", ...assessmentFields],
    "Research evidence",
  );
  requireTask(
    value.kind === "web_evidence",
    "Expected a research evidence note.",
  );
  parseWorkspaceOperationId(value.sourceOperationId);
  return {
    kind: value.kind,
    sourceOperationId: value.sourceOperationId,
    ...assessment(value),
  };
}

export function createResearchEvidence(value, page) {
  const tool = parseResearchEvidence(value);
  const normalize = (text) => text.replace(/\s+/gu, " ").trim();
  const content = normalize(page.text);
  requireTask(
    tool.excerpts.every((excerpt) => content.includes(normalize(excerpt))),
    "Research excerpts must appear in the saved page text.",
  );
  return {
    source: {
      operationId: tool.sourceOperationId,
      url: page.url,
      title: page.title,
      checkedAt: page.retrievedAt,
      truncated: page.truncated,
    },
    assessment: assessment(tool),
    verification: "source_text_only",
  };
}

export function parseResearchEvidenceResult(tool, value) {
  tool = parseResearchEvidence(tool);
  object(
    value,
    ["source", "assessment", "verification"],
    "Saved research evidence",
  );
  object(
    value.source,
    ["operationId", "url", "title", "checkedAt", "truncated"],
    "Research source",
  );
  requireTask(
    value.source.operationId === tool.sourceOperationId,
    "Research source identity does not match.",
  );
  text(value.source.url, 2048, "Research source URL");
  const url = new URL(value.source.url);
  requireTask(
    url.protocol === "https:" && !url.username && !url.password && !url.hash,
    "Research source requires public HTTPS without credentials or a fragment.",
  );
  text(value.source.title, 1200, "Research source title", true);
  text(value.source.checkedAt, 50, "Research source time");
  requireTask(
    Number.isFinite(Date.parse(value.source.checkedAt)),
    "Invalid research source time.",
  );
  requireTask(
    typeof value.source.truncated === "boolean",
    "Source truncation must be explicit.",
  );
  object(value.assessment, assessmentFields, "Research assessment");
  requireTask(
    JSON.stringify(assessment(value.assessment)) ===
      JSON.stringify(assessment(tool)),
    "Saved research assessment differs from its request.",
  );
  requireTask(
    value.verification === "source_text_only",
    "Research cannot certify access or successful execution.",
  );
  return structuredClone(value);
}

const string = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const notes = {
  type: "array",
  maxItems: limits.entries,
  items: string(limits.note),
};
export const researchEvidenceDefinition = {
  kind: "web_evidence",
  description:
    "Save a request-specific interpretation of a completed page read in this task. Cite its operation ID and exact excerpts; the platform supplies source URL and read time. This never tests or authorizes an integration.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "sourceOperationId", ...assessmentFields],
    properties: {
      kind: { const: "web_evidence" },
      sourceOperationId: { ...string(128), pattern: "^[A-Za-z0-9_-]+$" },
      operation: string(limits.operation),
      support: { enum: supportValues },
      excerpts: { type: "array", maxItems: 3, items: string(limits.excerpt) },
      accessRequirements: notes,
      uncertainty: notes,
      stillNeedsTesting: { ...notes, minItems: 1 },
    },
  },
};
