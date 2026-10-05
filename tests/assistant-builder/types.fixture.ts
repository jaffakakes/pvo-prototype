import {
  type BuilderTool,
  type BuilderDecision,
  type BuilderState,
  newBuilderState,
  builderStage,
  acceptBuilderDecision,
  beginBuilderBatch,
  nextBuilderTool,
  recordBuilderTool,
  type BuilderReadResult,
  parseBuilderTool,
  parseBuilderReadResult,
  builderToolDefinitions,
} from "../../packages/pvo-assistant/builder/index.js";
const tool: BuilderTool = parseBuilderTool({});
const result: BuilderReadResult = parseBuilderReadResult(tool, {});
const definitions = builderToolDefinitions([
  "workspace_list",
  "workspace_test",
]);
// @ts-expect-error arbitrary shells are not workspace tools
const shell: BuilderTool = { kind: "shell", command: "ls" };
const write: BuilderTool = {
  kind: "workspace_write",
  expectedRevision: 0,
  files: [],
  // @ts-expect-error model writes cannot supply task ownership
  ownerId: "foreign",
};
// @ts-expect-error checks must name the exact source digest
const check: BuilderTool = {
  kind: "workspace_check",
  revision: 1,
  path: "src/service.mjs",
};
void [tool, result, definitions, shell, write, check];

const initial: BuilderState = newBuilderState();
const question: BuilderDecision = {
  kind: "ask",
  prompt: "Which date?",
  choices: [],
};
const saved: BuilderState = acceptBuilderDecision(initial, question, null);
const stage: "model" | "tools" | "review" = builderStage(saved);
const batch = beginBuilderBatch(saved, 3);
const position = nextBuilderTool(batch);
if (position) recordBuilderTool(batch, position, { status: "completed" });
// @ts-expect-error model decisions cannot approve deployment
const deployment: BuilderDecision = { kind: "complete", ready: true };
void [stage, deployment];
