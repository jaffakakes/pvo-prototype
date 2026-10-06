import {
  matchAttachmentOperation,
  prepareComponentServiceConnection,
  validateCompiledServiceAttachment,
} from "../../../../../packages/pvo-assistant/attachments/index.js";
import { requestHost, checkedDomains } from "../../components/actions";
import { serviceAttachmentRequest } from "../../../../../packages/pvo-assistant/attachments/index.js";
import type { PvoComponent } from "../../project/model";
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
function validateAttachmentComponent(
  batch: Pick<NativeBatch, "before" | "project" | "attachment">,
): PvoComponent | null {
  const attachment = batch.attachment;
  if (!attachment) return null;
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
  return component;
}

/** Add metadata and its exact approved host only to an already validated isolated candidate. */
export function connectNativeBatchAttachment(batch: NativeBatch): void {
  const attachment = batch.attachment;
  if (!attachment) return;
  const component = validateAttachmentComponent(batch)!;
  component.serviceConnection = prepareComponentServiceConnection(
    attachment.authorization,
  );
  const host = requestHost(
    serviceAttachmentRequest(attachment.authorization).url,
  );
  batch.project.allowedDomains = checkedDomains([
    ...batch.project.allowedDomains,
    host,
  ]);
}

export function validateNativeBatchAttachment(
  batch: Pick<NativeBatch, "before" | "project" | "attachment">,
): void {
  const component = validateAttachmentComponent(batch);
  if (!component || !batch.attachment) return;
  const authorization = batch.attachment.authorization;
  if (
    JSON.stringify(component.serviceConnection) !==
      JSON.stringify(prepareComponentServiceConnection(authorization)) ||
    !batch.project.allowedDomains.includes(
      requestHost(serviceAttachmentRequest(authorization).url),
    )
  )
    throw new Error(
      "The component connection or approved service host changed before application.",
    );
}
