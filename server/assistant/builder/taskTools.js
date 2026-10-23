import {
  parseBuilderTool,
  serializeBuilderTool,
  readBuilderWorkspace,
} from "../../../packages/pvo-assistant/builder/index.js";
import { contentDigest } from "../../contentDigest.js";
import {
  runWorkspaceOperation,
  runJournaledWorkspaceOperation,
} from "../tasks/workspaceRunner.js";
import { createWorkspaceTools } from "./workspaceTools.js";

function resultOf(row) {
  if (!row?.settled || !row.receipt)
    throw Object.assign(
      new Error("Workspace tool result needs reconciliation."),
      { code: "reconciliation_required" },
    );
  return row.receipt;
}

/** Bind all advertised tools to one trusted saved-task claim. No ownership comes from the model. */
export function taskWorkspaceTools(coordinator, claimed) {
  if (!coordinator.workspaceProvider()) return createWorkspaceTools({});
  const operate = async (kind, request) =>
    resultOf(await runWorkspaceOperation(coordinator, claimed, kind, request));
  const read = async (operationId, value) => {
    const tool = parseBuilderTool(value);
    const digest = await contentDigest(serializeBuilderTool(tool));
    const row = await runJournaledWorkspaceOperation(
      coordinator,
      claimed,
      "read",
      operationId,
      digest,
      async (provider, identity) => {
        const result =
          tool.kind === "workspace_result"
            ? await provider.receipt(identity, tool.operationId)
            : readBuilderWorkspace(
                (await provider.lookup(identity)).source,
                tool,
              );
        return {
          id: operationId,
          kind: "read",
          digest,
          status: "completed",
          result,
        };
      },
    );
    return resultOf(row).result;
  };
  return createWorkspaceTools({
    read,
    receipt: (id, operationId) =>
      read(id, { kind: "workspace_result", operationId }),
    write: (request) => operate("save", request),
    start: (request) => operate("start", request),
    command: (request) => operate("command", request),
  });
}
