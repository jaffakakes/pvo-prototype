import {
  builderToolDefinitions,
  parseBuilderTool,
  parseBuilderReadResult,
} from "../../../packages/pvo-assistant/builder/index.js";
import {
  parseWorkspaceOperationId,
  parseWorkspaceReceipt,
} from "../../../packages/pvo-assistant/workspaces/index.js";

const capability = {
  workspace_list: "read",
  workspace_read: "read",
  workspace_write: "write",
  workspace_start: "start",
  workspace_check: "command",
  workspace_test: "command",
  workspace_result: "receipt",
};

/** These narrow adapters are already bound to an owned task/claim and its durable usage journal. */
export function createWorkspaceTools(adapters) {
  const available = Object.keys(capability).filter(
    (kind) => typeof adapters?.[capability[kind]] === "function",
  );
  return {
    definitions: builderToolDefinitions(available),
    async execute(value, operationId) {
      const tool = parseBuilderTool(value);
      parseWorkspaceOperationId(operationId);
      if (!available.includes(tool.kind))
        throw new Error("Workspace tool is unavailable.");
      if (["workspace_list", "workspace_read"].includes(tool.kind)) {
        // The adapter commits the bounded result under the owned task's usage reservation.
        const result = await adapters.read(operationId, tool);
        return parseBuilderReadResult(tool, result);
      }
      if (tool.kind === "workspace_result") {
        const result = await adapters.receipt(operationId, tool.operationId);
        if (result === null)
          return {
            operationId: tool.operationId,
            status: "unknown",
            result: null,
          };
        const receipt = parseWorkspaceReceipt(result);
        if (receipt.id !== tool.operationId)
          throw new Error(
            "Receipt does not belong to the requested operation.",
          );
        return receipt;
      }
      let result;
      if (tool.kind === "workspace_write")
        result = await adapters.write({
          id: operationId,
          expectedRevision: tool.expectedRevision,
          files: tool.files,
        });
      else {
        const request = {
          id: operationId,
          revision: tool.revision,
          digest: tool.digest,
        };
        result =
          tool.kind === "workspace_start"
            ? await adapters.start(request)
            : await adapters.command({
                ...request,
                command:
                  tool.kind === "workspace_check"
                    ? { kind: "check", paths: [tool.path] }
                    : { kind: "test", paths: tool.paths },
              });
      }
      const receipt = parseWorkspaceReceipt(result);
      const kind =
        tool.kind === "workspace_write"
          ? "save"
          : tool.kind === "workspace_start"
            ? "start"
            : "command";
      if (receipt.id !== operationId || receipt.kind !== kind)
        throw new Error("Workspace result does not match its tool call.");
      return receipt;
    },
  };
}
