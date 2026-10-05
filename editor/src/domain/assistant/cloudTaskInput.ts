import {
  parseTaskInput,
  parseTaskProposal,
  type TaskInput,
  type TaskProposal,
} from "../../../../packages/pvo-assistant/tasks/index.js";
import type { ProjectSnapshot } from "../project/model";
import { nativeProjectContext } from "./native/context";

/** Reuse the private-data projection: no media URLs, archived drafts or request payloads. */
export function cloudTaskInput(
  project: ProjectSnapshot,
  request: string,
  proposal: TaskProposal,
  identity: { projectId: string; operationId: string },
): TaskInput {
  const context = nativeProjectContext(project, 0);
  const components = context.scenes.flatMap((scene) =>
    scene.components.map((component) => {
      const source = component.source ?? component.design;
      if (!source)
        throw new Error(
          "Finish or correct the component's pending source before starting a cloud task.",
        );
      return {
        id: component.id,
        sceneId: scene.id,
        type: component.type,
        source,
      };
    }),
  );
  return parseTaskInput({
    ...identity,
    request,
    ...parseTaskProposal(proposal),
    context: { fingerprint: context.fingerprint, components },
  });
}
