import {
  matchAttachmentOperation,
  validateCompiledServiceAttachment,
} from "../../../../../packages/pvo-assistant/attachments/index.js";
import type { NativeOperation } from "../../../../../packages/pvo-assistant/native/index.js";
import { componentLanguageModel } from "../../components/languageEditing";
import { sceneDuration } from "../../scenes/duration";
import type { NativeBatch, NativePreparation } from "./types";

export function validateAttachmentBatchInput(
  operations: readonly NativeOperation[],
  options: NativePreparation,
): void {
  if (
    options.attachment &&
    operations.filter((operation) =>
      matchAttachmentOperation(operation, options.attachment),
    ).length !== 1
  )
    throw new Error(
      "A verified attachment must match exactly one component proposal.",
    );
}

/** Recheck the one authorized connection against the final candidate before entering history. */
export function validateNativeBatchAttachment(
  batch: Pick<NativeBatch, "before" | "project" | "attachment">,
): void {
  const attachment = batch.attachment;
  if (!attachment) return;
  const scene = batch.project.scenes.find(
    (item) => item.id === attachment.sceneId,
  );
  const component = scene?.components.find(
    (item) => item.id === attachment.componentId,
  );
  if (!scene || !component)
    throw new Error(
      "The attached component is no longer in the prepared project.",
    );
  const before = batch.before.scenes
    .find((item) => item.id === scene.id)
    ?.components.find((item) => item.id === component.id);
  const compiled = {
    ...componentLanguageModel(component),
    html: "",
    css: "",
    js: "",
  };
  const original = before
    ? { ...componentLanguageModel(before), html: "", css: "", js: "" }
    : null;
  validateCompiledServiceAttachment(
    original,
    compiled,
    attachment.authorization,
    {
      currentSceneId: scene.id,
      duration: sceneDuration(scene),
      scenes: batch.project.scenes
        .filter((item) => sceneDuration(item) > 0)
        .map((item) => ({ id: item.id, name: item.name })),
    },
  );
}
