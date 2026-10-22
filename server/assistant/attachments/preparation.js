import { validateManualComponent } from "../../../packages/pvo-assistant/tasks/index.js";
import { AuthoringRepairError } from "../tasks/repairFeedback.js";
import {
  parseServiceAttachmentCommand,
  validateServiceResultNote,
} from "../../../packages/pvo-assistant/attachments/index.js";
import { preparedTaskComponentId } from "../../../packages/pvo-assistant/results/index.js";
import { validateNativeResult } from "../native/policy.js";
import { resolveTaskAttachment } from "./receipt.js";

/** Compile and recheck real hosted evidence before hashing an immutable component result. */
export async function prepareTaskAttachment(coordinator, task, value) {
  const command = parseServiceAttachmentCommand(value);
  const attachment = await resolveTaskAttachment(coordinator, task, command);
  const authorization = {
    ...attachment,
    scope: {
      ownerId: task.ownerId,
      projectId: task.input.projectId,
      taskId: task.id,
    },
    now: coordinator.now(),
    origin: coordinator.env.PUBLIC_ORIGIN,
  };
  const context = task.input.context;
  const operation = command.component;
  const operations = [operation, ...command.notes];
  const componentId =
    operation.kind === "component.add"
      ? preparedTaskComponentId(task.id, 1)
      : operation.componentId;
  if (operation.kind === "component.add" && operation.duration === null)
    throw new AuthoringRepairError(
      "component_validation",
      "A new connected component needs an explicit visible duration.",
      value,
    );
  const scenes = context.scenes.map((scene) => ({
    ...scene,
    duration: operations.reduce(
      (duration, item) =>
        item.kind === "component.add" && item.sceneId === scene.id
          ? Math.max(duration, item.at + item.duration)
          : duration,
      scene.duration,
    ),
    components: context.components
      .filter((component) => component.sceneId === scene.id)
      .map((component) => ({
        id: component.id,
        type: component.type,
        [component.sourceVisibility === "full" ? "source" : "design"]:
          component.source,
      })),
  }));
  try {
    await validateNativeResult(
      {
        mode: "edit",
        project: { scenes: scenes.filter((scene) => scene.duration > 0) },
      },
      {
        message: "Prepared component connection.",
        operations,
        observations: [],
      },
      async (type, source) => {
        const compiled = await coordinator.compileAttachment(type, source);
        if (source === operation.source)
          validateManualComponent(task, compiled, command.connection.input);
        if (command.notes.some((note) => note.source === source))
          validateServiceResultNote(
            compiled,
            componentId,
            attachment.receipt.operation,
          );
        return compiled;
      },
      authorization,
    );
  } catch (error) {
    throw new AuthoringRepairError(
      "component_validation",
      error.message,
      value,
    );
  }
  const encoded = await coordinator.results.encode(
    task,
    operations,
    attachment,
  );
  return {
    encoded,
    command: {
      kind: "complete",
      result: {
        artifact: encoded.artifact,
        baseFingerprint: context.fingerprint,
      },
    },
  };
}
