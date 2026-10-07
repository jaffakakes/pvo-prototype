import { parseBuilderResearch } from "./research.js";
import {
  boundedJson,
  choice,
  digest,
  integer,
  list,
  object,
  requireTask,
  text,
  unique,
} from "../tasks/validation.js";
import { TASK_LIMITS } from "../tasks/index.js";
import {
  resolveNodeLibraries,
  parseServiceAgreement,
  parseServiceFilePath,
  SERVICE_PACKAGE_LIMITS,
} from "../services/index.js";
import { parseBuilderTool } from "./tools.js";

export const BUILDER_LIMITS = Object.freeze({
  batchCalls: 4,
  decisionBytes: 1024 * 1024 + 4096,
  feedbackBytes: 128 * 1024,
  feedbackEntries: 24,
  promptBytes: 640 * 1024,
});
const fields = {
  agreement: ["agreement"],
  research: ["calls"],
  ask: ["prompt", "choices"],
  tools: ["calls", "review"],
  review: ["revision", "digest", "entrypoint", "tests", "libraries"],
};

/** Closed model output; agreement comes before any generated source and cannot be replaced. */
export function parseBuilderDecision(value, { hasAgreement, available }) {
  const kind = value && Object.getOwnPropertyDescriptor(value, "kind")?.value;
  object(value, ["kind", ...(fields[kind] ?? [])], "Builder decision");
  choice(
    kind,
    hasAgreement
      ? ["ask", "tools", "research", "review"]
      : ["ask", "agreement", "research"],
    "Builder stage",
  );
  if (kind === "agreement") parseServiceAgreement(value.agreement);
  if (kind === "ask") {
    text(value.prompt, TASK_LIMITS.questionBytes, "Builder question");
    list(value.choices, TASK_LIMITS.choices, "Builder choices");
    for (const item of value.choices)
      text(item, TASK_LIMITS.choiceBytes, "Builder choice");
    unique(value.choices, "Builder choices");
  }
  if (kind === "research") {
    list(value.calls, 2, "Public research batch");
    requireTask(value.calls.length > 0, "Research must request evidence.");
    for (const call of value.calls) {
      const parsed = parseBuilderResearch(call);
      requireTask(
        available.includes(parsed.kind),
        "Public research is unavailable.",
      );
    }
  }
  if (kind === "tools") {
    list(value.calls, BUILDER_LIMITS.batchCalls, "Builder tool batch");
    requireTask(value.calls.length > 0, "A tool batch must do work.");
    for (const call of value.calls) {
      const parsed = parseBuilderTool(call);
      requireTask(
        available.includes(parsed.kind),
        "The builder requested an unavailable tool.",
      );
    }
  }
  if (kind === "tools" && value.review !== null) {
    requireTask(
      value.review?.kind === "review",
      "A batch can only request review after success.",
    );
    parseBuilderDecision(value.review, { hasAgreement, available });
  }
  if (kind === "review") {
    resolveNodeLibraries(value.libraries);
    integer(value.revision, Number.MAX_SAFE_INTEGER, "Source revision", 1);
    digest(value.digest, "Saved source digest");
    parseServiceFilePath(value.entrypoint);
    requireTask(
      value.entrypoint.startsWith("src/"),
      "The entry point must be source.",
    );
    list(value.tests, SERVICE_PACKAGE_LIMITS.tests, "Generated tests");
    requireTask(value.tests.length > 0, "Review requires generated tests.");
    for (const path of value.tests) {
      parseServiceFilePath(path);
      requireTask(
        path.startsWith("tests/") && path.endsWith(".test.mjs"),
        "Review requires named test modules.",
      );
    }
    unique(value.tests, "Generated tests");
  }
  boundedJson(value, BUILDER_LIMITS.decisionBytes, "Builder decision");
  return structuredClone(value);
}
