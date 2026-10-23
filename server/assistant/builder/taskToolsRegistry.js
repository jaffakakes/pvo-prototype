import { BUILDER_RESEARCH_KINDS } from "../../../packages/pvo-assistant/builder/index.js";
import { taskResearchTools } from "./researchTools.js";
import { taskWorkspaceTools } from "./taskTools.js";

/** Compose only configured adapters for one trusted task; each adapter owns its operation journal. */
export function taskBuilderTools(coordinator, claimed) {
  const workspace = taskWorkspaceTools(coordinator, claimed),
    research = taskResearchTools(coordinator, claimed);
  return {
    definitions: [...workspace.definitions, ...research.definitions],
    execute: (tool, id) =>
      (BUILDER_RESEARCH_KINDS.includes(tool.kind)
        ? research
        : workspace
      ).execute(tool, id),
  };
}
