import type { ServiceSourceFile } from "../services/index.js";
import type { WorkspaceSnapshot } from "../workspaces/index.js";
export type BuilderTool =
  | { kind: "workspace_list" }
  | { kind: "workspace_read"; revision: number; path: string; offset: number }
  | {
      kind: "workspace_write";
      expectedRevision: number;
      files: ServiceSourceFile[];
    }
  | ({ revision: number; digest: string } & (
      | { kind: "workspace_start" }
      | { kind: "workspace_check"; path: string }
      | { kind: "workspace_test"; paths: string[] }
    ))
  | { kind: "workspace_result"; operationId: string };
export const BUILDER_TOOL_LIMITS: Readonly<{
  readBytes: number;
}>;
export const BUILDER_TOOL_KINDS: readonly BuilderTool["kind"][];
export function parseBuilderTool(value: unknown): BuilderTool;
export type BuilderReadResult =
  | {
      revision: number;
      digest: string | null;
      files: Array<{ path: string; bytes: number }>;
    }
  | {
      revision: number;
      digest: string;
      path: string;
      offset: number;
      content: string;
      nextOffset: number | null;
    };
export function readBuilderWorkspace(
  source: WorkspaceSnapshot | null,
  tool: BuilderTool,
): BuilderReadResult;
export function builderToolDefinitions(
  available: readonly BuilderTool["kind"][],
): Array<{ kind: BuilderTool["kind"]; description: string; schema: object }>;
export function parseBuilderReadResult(
  tool: BuilderTool,
  value: unknown,
): BuilderReadResult;
export function serializeBuilderTool(value: unknown): string;
export type BuilderDecision =
  | { kind: "research"; calls: BuilderResearch[] }
  | {
      kind: "agreement";
      agreement: import("../services/index.js").ServiceAgreement;
    }
  | { kind: "ask"; prompt: string; choices: string[] }
  | {
      kind: "tools";
      calls: BuilderTool[];
      review: Extract<BuilderDecision, { kind: "review" }> | null;
    }
  | {
      kind: "review";
      revision: number;
      digest: string;
      entrypoint: string;
      tests: string[];
    };
export const BUILDER_LIMITS: Readonly<{
  batchCalls: number;
  decisionBytes: number;
  feedbackBytes: number;
  feedbackEntries: number;
  promptBytes: number;
}>;
export function parseBuilderDecision(
  value: unknown,
  stage: {
    hasAgreement: boolean;
    available: readonly (BuilderTool["kind"] | BuilderResearch["kind"])[];
  },
): BuilderDecision;
export function builderDecisionSchema(
  hasAgreement: boolean,
  definitions: Array<{
    kind: BuilderTool["kind"] | BuilderResearch["kind"];
    description: string;
    schema: object;
  }>,
): object;

export type BuilderReviewFeedback = {
  review: Extract<BuilderDecision, { kind: "review" }>;
  report: import("../services/index.js").ServiceTestReport | null;
  error: string | null;
};
export function builderReviewRequest(
  value: BuilderState,
): Extract<BuilderDecision, { kind: "review" }> | null;
export function recordBuilderReview(
  value: BuilderState,
  feedback: BuilderReviewFeedback,
): BuilderState;
export type BuilderState = {
  round: number;
  agreement: {
    digest: string;
    body: import("../services/index.js").ServiceAgreement;
  } | null;
  decision: BuilderDecision | null;
  cursor: number;
  claimGeneration: number | null;
  batchEnd: "completed" | "failed" | "interrupted" | null;
  feedback: Array<{
    operationId: string;
    kind: BuilderTool["kind"] | BuilderResearch["kind"];
    result: unknown;
  }>;
  omittedFeedback: number;
  reviewFeedback: BuilderReviewFeedback | null;
};
export type BuilderPosition = {
  round: number;
  index: number;
  operationId: string;
  tool: BuilderTool | BuilderResearch;
};
export function newBuilderState(): BuilderState;
export function parseBuilderState(value: unknown): BuilderState;
export function builderStage(value: BuilderState): "model" | "tools" | "review";
export function acceptBuilderDecision(
  value: BuilderState,
  decision: BuilderDecision,
  agreementDigest: string | null,
): BuilderState;
export function beginBuilderBatch(
  value: BuilderState,
  generation: number,
): BuilderState;
export function nextBuilderTool(value: BuilderState): BuilderPosition | null;
export function recordBuilderTool(
  value: BuilderState,
  position: BuilderPosition,
  result: unknown,
  halt?: boolean,
): BuilderState;
export function interruptBuilderBatch(value: BuilderState): BuilderState;
export function builderContext(value: BuilderState): {
  agreement: BuilderState["agreement"];
  round: number;
  lastDecision: unknown;
  batchEnd: BuilderState["batchEnd"];
  feedback: BuilderState["feedback"];
  omittedFeedback: number;
  reviewFeedback: BuilderReviewFeedback | null;
};

export type BuilderResearch =
  { kind: "web_search"; query: string } | { kind: "web_read"; url: string };
export const BUILDER_RESEARCH_KINDS: readonly BuilderResearch["kind"][];
export const BUILDER_RESEARCH_LIMITS: Readonly<{
  queryBytes: number;
  urlBytes: number;
  resultBytes: number;
  textBytes: number;
}>;
export type BuilderResearchResult =
  | {
      kind: BuilderResearch["kind"];
      status: "unknown" | "unavailable";
      result: null;
    }
  | {
      kind: "web_search";
      status: "completed";
      result: {
        query: string;
        results: Array<{ title: string; url: string; snippet: string }>;
        source: string;
        retrievedAt: string;
      };
    }
  | {
      kind: "web_read";
      status: "completed";
      result: {
        url: string;
        title: string;
        text: string;
        links: Array<{ title: string; url: string }>;
        retrievedAt: string;
        truncated: boolean;
      };
    };
export function parseBuilderResearch(value: unknown): BuilderResearch;
export function serializeBuilderResearch(value: unknown): string;
export function parseBuilderResearchResult(
  tool: BuilderResearch,
  value: unknown,
): BuilderResearchResult;
export function builderResearchDefinitions(
  available: readonly BuilderResearch["kind"][],
): Array<{
  kind: BuilderResearch["kind"];
  description: string;
  schema: object;
}>;
