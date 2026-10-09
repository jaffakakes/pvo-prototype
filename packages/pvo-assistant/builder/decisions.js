import { parseConnectionSetup } from "../connections/setup.js";
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
import { TASK_LIMITS, parseManualAlternative } from "../tasks/index.js";
import {
  resolveNodeLibraries,
  parseServiceAgreement,
  parseServiceFilePath,
  SERVICE_PACKAGE_LIMITS,
} from "../services/index.js";
import { BUILDER_TOOL_KINDS, parseBuilderTool } from "./tools.js";

export const BUILDER_LIMITS = Object.freeze({
  batchCalls: 4,
  decisionBytes: 1024 * 1024 + 4096,
  feedbackBytes: 128 * 1024,
  feedbackEntries: 24,
  promptBytes: 640 * 1024,
});
const fields = {
  manual_alternative: ["proposal"],
  agreement: ["agreement"],
  research: ["calls"],
  ask_research: ["prompt", "choices", "calls"],
  ask: ["prompt", "choices"],
  connect_account: ["setup", "purpose"],
  tools: ["calls", "review"],
  review: ["revision", "digest", "entrypoint", "tests", "libraries"],
};

/** Closed model output; agreement comes before any generated source and cannot be replaced. */
export function parseBuilderDecision(
  value,
  { hasAgreement, available, connectionSetup = false },
) {
  const kind = value && Object.getOwnPropertyDescriptor(value, "kind")?.value;
  requireTask(
    !BUILDER_TOOL_KINDS.includes(kind),
    hasAgreement
      ? 'A workspace tool cannot be the top-level builder decision. Return {"kind":"tools","calls":[the workspace tool object],"review":null}. Keep the tool kind and its fields inside calls.'
      : "A workspace tool cannot be the top-level builder decision. Propose a valid behavior agreement before generating source or using workspace tools.",
  );
  object(value, ["kind", ...(fields[kind] ?? [])], "Builder decision");
  choice(
    kind,
    hasAgreement
      ? [
          "ask",
          "connect_account",
          "tools",
          "research",
          "ask_research",
          "review",
        ]
      : [
          "ask",
          "connect_account",
          "manual_alternative",
          "agreement",
          "research",
          "ask_research",
        ],
    "Builder stage",
  );
  if (kind === "connect_account") {
    requireTask(connectionSetup, "Private account setup is unavailable.");
    value = { ...value, setup: parseConnectionSetup(value.setup) };
    requireTask(
      ["github", "resend"].includes(value.setup.provider),
      "Use the human agent identity setup; account signup automation is not installed yet.",
    );
    text(value.purpose, 1024, "Connection purpose");
  }
  if (kind === "manual_alternative") parseManualAlternative(value.proposal);
  if (kind === "agreement") parseServiceAgreement(value.agreement);
  if (["ask", "ask_research"].includes(kind)) {
    text(value.prompt, TASK_LIMITS.questionBytes, "Builder question");
    list(value.choices, TASK_LIMITS.choices, "Builder choices");
    for (const item of value.choices)
      text(item, TASK_LIMITS.choiceBytes, "Builder choice");
    unique(value.choices, "Builder choices");
  }
  if (["research", "ask_research"].includes(kind)) {
    list(value.calls, 2, "Public research batch");
    requireTask(value.calls.length > 0, "Research must request evidence.");
    for (const call of value.calls) {
      const parsed = parseBuilderResearch(call);
      requireTask(
        kind !== "ask_research" || parsed.kind !== "capability_record",
        "Waiting research cannot decide the unanswered outcome.",
      );
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
    parseBuilderDecision(value.review, {
      hasAgreement,
      available,
      connectionSetup,
    });
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
