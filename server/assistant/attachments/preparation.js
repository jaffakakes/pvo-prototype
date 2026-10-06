import { AuthoringRepairError } from "../tasks/repairFeedback.js";
import { parseServiceAttachmentCommand } from "../../../packages/pvo-assistant/attachments/index.js";
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
  if (operation.kind === "component.add" && operation.duration === null)
    throw new AuthoringRepairError(
      "component_validation",
      "A new connected component needs an explicit visible duration.",
      value,
    );
  const scenes = context.scenes.map((scene) => ({
    ...scene,
    duration:
      operation.kind === "component.add" && operation.sceneId === scene.id
        ? Math.max(scene.duration, operation.at + operation.duration)
        : scene.duration,
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
        operations: [operation],
        observations: [],
      },
      (type, source) => coordinator.compileAttachment(type, source),
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
    [operation],
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
