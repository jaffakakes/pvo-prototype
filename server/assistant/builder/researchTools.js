import {
  parseBuilderResearch,
  parseBuilderResearchResult,
  serializeBuilderResearch,
  builderResearchDefinitions,
  createResearchEvidence,
} from "../../../packages/pvo-assistant/builder/index.js";
import { parseWorkspaceOperationId } from "../../../packages/pvo-assistant/workspaces/index.js";
import { contentDigest } from "../../contentDigest.js";
import { withAssistantDeadline } from "../deadline.js";

/** Task-owned read-only research. All network effects are journaled, bounded and cancelled by Stop. */
export function taskResearchTools(coordinator, claimed) {
  const provider = coordinator.researchProvider();
  return {
    definitions: [
      ...(provider?.definitions ?? []),
      ...builderResearchDefinitions(["web_evidence"]),
    ],
    async execute(value, operationId) {
      const tool = parseBuilderResearch(value);
      parseWorkspaceOperationId(operationId);
      if (!provider && tool.kind !== "web_evidence")
        throw new Error("Public research is unavailable.");
      const digest = await contentDigest(serializeBuilderResearch(tool));
      let row = await coordinator.transaction(() =>
        coordinator.research.begin(
          claimed,
          operationId,
          tool,
          digest,
          coordinator.now(),
        ),
      );
      if (!row) throw new Error("Research claim is no longer current.");
      if (row.settled) return parseBuilderResearchResult(tool, row.result);
      if (row.dispatched)
        throw Object.assign(new Error("Research needs reconciliation."), {
          code: "reconciliation_required",
        });
      const controller = new AbortController();
      coordinator.active.set(claimed.id, controller);
      try {
        const dispatched = await coordinator.transaction(() =>
          coordinator.research.dispatch(
            claimed,
            operationId,
            coordinator.now(),
          ),
        );
        if (!dispatched)
          throw new Error("Research claim is no longer current.");
        let result;
        try {
          result = await withAssistantDeadline(
            async (signal) => {
              signal.throwIfAborted();
              if (!coordinator.builders.current(claimed, coordinator.now()))
                throw new DOMException("Task stopped", "AbortError");
              if (tool.kind === "web_evidence") {
                const source = coordinator.research.get(
                  claimed.id,
                  tool.sourceOperationId,
                );
                if (
                  !source?.settled ||
                  source.tool.kind !== "web_read" ||
                  source.result?.status !== "completed"
                )
                  return {
                    kind: tool.kind,
                    status: "unavailable",
                    result: null,
                  };
                const page = parseBuilderResearchResult(
                  source.tool,
                  source.result,
                ).result;
                try {
                  return parseBuilderResearchResult(tool, {
                    kind: tool.kind,
                    status: "completed",
                    result: createResearchEvidence(tool, page),
                  });
                } catch {
                  return {
                    kind: tool.kind,
                    status: "unavailable",
                    result: null,
                  };
                }
              }
              return parseBuilderResearchResult(
                tool,
                await provider.execute(tool, signal),
              );
            },
            Math.max(1, Math.min(10000, row.deadlineAt - coordinator.now())),
            controller.signal,
          );
        } catch {
          result = { kind: tool.kind, status: "unknown", result: null };
        }
        row = await coordinator.transaction(() =>
          coordinator.research.finish(
            claimed.id,
            operationId,
            result,
            coordinator.now(),
          ),
        );
        return parseBuilderResearchResult(tool, row.result);
      } finally {
        if (coordinator.active.get(claimed.id) === controller)
          coordinator.active.delete(claimed.id);
      }
    },
  };
}
