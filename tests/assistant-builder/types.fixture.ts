import {
  type BuilderTool,
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
