import {
  boundedJson,
  choice,
  digest,
  integer,
  id,
  list,
  object,
  requireTask,
} from "../tasks/validation.js";
import { TASK_LIMITS } from "../tasks/index.js";
import {
  parseServiceAgreement,
  serializeServiceAgreement,
} from "../services/index.js";
import { BUILDER_TOOL_KINDS } from "./tools.js";
import { BUILDER_LIMITS, parseBuilderDecision } from "./decisions.js";

export function newBuilderState() {
  return {
    round: 0,
    agreement: null,
    decision: null,
    cursor: 0,
    claimGeneration: null,
    batchEnd: null,
    feedback: [],
    omittedFeedback: 0,
  };
}

export function parseBuilderState(value) {
  object(
    value,
    [
      "round",
      "agreement",
      "decision",
      "cursor",
      "claimGeneration",
      "batchEnd",
      "feedback",
      "omittedFeedback",
    ],
    "Saved builder",
  );
  integer(value.round, TASK_LIMITS.modelTurns, "Builder round");
  if (value.agreement !== null) {
    object(value.agreement, ["digest", "body"], "Saved agreement");
    digest(value.agreement.digest, "Agreement digest");
    parseServiceAgreement(value.agreement.body);
  }
  if (value.decision !== null) {
    parseBuilderDecision(value.decision, {
      hasAgreement: value.decision.kind !== "agreement",
      available: BUILDER_TOOL_KINDS,
    });
    requireTask(value.round > 0, "A decision needs a saved round.");
    if (value.decision.kind === "agreement")
      requireTask(
        value.agreement !== null &&
          serializeServiceAgreement(value.decision.agreement) ===
            serializeServiceAgreement(value.agreement.body),
        "Saved agreement cannot be changed by a decision.",
      );
    if (["tools", "review"].includes(value.decision.kind))
      requireTask(
        value.agreement !== null,
        "Source work requires a saved agreement.",
      );
  } else
    requireTask(
      value.round === 0 && value.agreement === null,
      "Builder initialization is incomplete.",
    );
  const calls =
    value.decision?.kind === "tools" ? value.decision.calls.length : 0;
  integer(value.cursor, calls, "Tool batch cursor");
  if (value.claimGeneration !== null)
    integer(
      value.claimGeneration,
      Number.MAX_SAFE_INTEGER,
      "Tool batch claim",
      1,
    );
  if (value.batchEnd !== null)
    choice(
      value.batchEnd,
      ["completed", "failed", "interrupted"],
      "Tool batch outcome",
    );
  requireTask(
    calls > 0 || (value.claimGeneration === null && value.batchEnd === null),
    "Only a tool batch has execution state.",
  );
  requireTask(
    value.batchEnd === null || value.cursor === calls,
    "A finished batch must close its cursor.",
  );
  requireTask(
    !calls || value.cursor < calls || value.batchEnd !== null,
    "A closed cursor needs an outcome.",
  );
  requireTask(
    value.cursor === 0 || value.claimGeneration !== null,
    "Tool progress needs a claim.",
  );
  list(value.feedback, TASK_LIMITS.toolCalls, "Tool feedback");
  for (const item of value.feedback) {
    object(item, ["operationId", "kind", "result"], "Saved tool feedback");
    id(item.operationId, "Feedback operation ID");
    choice(item.kind, BUILDER_TOOL_KINDS, "Feedback tool kind");
  }
  boundedJson(value.feedback, BUILDER_LIMITS.feedbackBytes, "Tool feedback");
  integer(value.omittedFeedback, TASK_LIMITS.toolCalls, "Omitted feedback");
  requireTask(
    value.feedback.length + value.omittedFeedback <= TASK_LIMITS.toolCalls,
    "Too many saved tool results.",
  );
  boundedJson(value, 2 * 1024 * 1024, "Saved builder");
  return structuredClone(value);
}

export function builderStage(value) {
  const state = parseBuilderState(value);
  if (
    state.decision?.kind === "review" ||
    (state.decision?.kind === "tools" &&
      state.batchEnd === "completed" &&
      state.decision.review !== null)
  )
    return "review";
  if (state.decision?.kind === "tools" && state.batchEnd === null)
    return "tools";
  return "model";
}

export function acceptBuilderDecision(value, decision, agreementDigest) {
  const state = parseBuilderState(value);
  requireTask(
    builderStage(state) === "model",
    "Finish the saved batch before another decision.",
  );
  decision = parseBuilderDecision(decision, {
    hasAgreement: state.agreement !== null,
    available: BUILDER_TOOL_KINDS,
  });
  const agreement =
    decision.kind === "agreement"
      ? { digest: agreementDigest, body: decision.agreement }
      : state.agreement;
  return parseBuilderState({
    ...state,
    round: state.round + 1,
    agreement,
    decision,
    cursor: 0,
    claimGeneration: null,
    batchEnd: null,
  });
}

export function beginBuilderBatch(value, generation) {
  const state = parseBuilderState(value);
  requireTask(builderStage(state) === "tools", "No saved batch is waiting.");
  integer(generation, Number.MAX_SAFE_INTEGER, "Tool batch claim", 1);
  requireTask(
    state.claimGeneration === null || state.claimGeneration === generation,
    "The old tool batch needs reconciliation.",
  );
  return parseBuilderState({ ...state, claimGeneration: generation });
}

export function nextBuilderTool(value) {
  const state = parseBuilderState(value);
  if (builderStage(state) !== "tools") return null;
  return {
    round: state.round,
    index: state.cursor,
    operationId: `build-${state.round}-${state.cursor}`,
    tool: state.decision.calls[state.cursor],
  };
}

export function recordBuilderTool(value, position, result, halt = false) {
  const state = parseBuilderState(value);
  const next = nextBuilderTool(state);
  requireTask(
    next &&
      next.round === position.round &&
      next.index === position.index &&
      state.claimGeneration !== null,
    "Tool feedback belongs to a different batch position.",
  );
  const feedback = [
    ...state.feedback,
    { operationId: next.operationId, kind: next.tool.kind, result },
  ];
  let omittedFeedback = state.omittedFeedback;
  while (
    new TextEncoder().encode(JSON.stringify(feedback)).length >
      BUILDER_LIMITS.feedbackBytes ||
    feedback.length > TASK_LIMITS.toolCalls
  ) {
    requireTask(
      feedback.length > 1,
      "A tool response exceeds the feedback budget.",
    );
    feedback.shift();
    omittedFeedback++;
  }
  const cursor = halt ? state.decision.calls.length : state.cursor + 1;
  return parseBuilderState({
    ...state,
    cursor,
    feedback,
    omittedFeedback,
    batchEnd: halt
      ? "failed"
      : cursor === state.decision.calls.length
        ? "completed"
        : null,
  });
}

export function interruptBuilderBatch(value) {
  const state = parseBuilderState(value);
  requireTask(
    builderStage(state) === "tools",
    "No tool batch needs interruption.",
  );
  return parseBuilderState({
    ...state,
    cursor: state.decision.calls.length,
    batchEnd: "interrupted",
  });
}

/** Keep complete receipts in their journal; project only bounded recent decision/feedback into inference. */
export function builderContext(value) {
  const state = parseBuilderState(value);
  let lastDecision = state.decision;
  if (
    lastDecision?.kind === "tools" &&
    new TextEncoder().encode(JSON.stringify(lastDecision)).length > 64 * 1024
  )
    lastDecision = {
      kind: "tools",
      contentOmitted: true,
      calls: lastDecision.calls.map((call) =>
        call.kind === "workspace_write"
          ? {
              kind: call.kind,
              expectedRevision: call.expectedRevision,
              files: call.files.map((file) => ({
                path: file.path,
                bytes: new TextEncoder().encode(file.content).length,
              })),
            }
          : call,
      ),
    };
  return {
    agreement: state.agreement,
    round: state.round,
    lastDecision,
    batchEnd: state.batchEnd,
    feedback: state.feedback,
    omittedFeedback: state.omittedFeedback,
  };
}
