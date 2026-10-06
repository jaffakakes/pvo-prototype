import type { NativeOperation } from "../../../../../packages/pvo-assistant/native/index.js";
import { matchAttachmentOperation, validateCompiledServiceAttachment } from "../../../../../packages/pvo-assistant/attachments/index.js";
import { validateCompiledAssistantProposal } from "../../../../../packages/pvo-assistant/policy.js";
import { validateNoCodeAssistantProposal } from "../../../../../packages/pvo-assistant/no-code-policy.js";
import { isVisualEditingBlocked } from "../../components/codeOwnership";
import { changeComponent, createDefaultComponent } from "../../components/editing";
import { fieldsShownFor } from "../../components/fields";
import { compiledComponentChanges, componentLanguageSource, validateEditableLanguage } from "../../components/languageCompilation";
import { preparePvoFormatting } from "../../components/languageFormatPreparation";
import { componentLanguageModel } from "../../components/languageEditing";
import { acceptsResponse, assertResponsePolicyContract, responsePolicyFor } from "../../components/responsePolicy";
import { scaleComponentUniformly } from "../../components/scale";
import type { ComponentFields, ProjectSnapshot, PvoComponent, Scene } from "../../project/model";
import { sceneDuration } from "../../scenes/duration";
import { validateAssistantContext } from "../context";
import type { NativePreparation } from "./types";
import { validateNativeBatchAttachment } from "./serviceAttachments";

type ComponentOperation = Extract<NativeOperation, { kind: "component.add" | "component.update" | "component.content" | "component.style" | "component.source" | "component.delete" }>;

function contentFields(original: PvoComponent, changes: Extract<ComponentOperation, { kind: "component.content" }>["changes"]): ComponentFields {
  const { buttonLabels, optionLabels, ...text } = changes;
  const fields = fieldsShownFor(original);
  const allowed = original.type === "tooltip" ? ["text"] : original.type === "card" ? ["title", "body"]
    : original.type === "choice" ? ["prompt"] : ["heading", "submitLabel"];
  if (Object.keys(text).some(key => !allowed.includes(key))) throw new Error("That content field does not belong to this component.");
  if (buttonLabels && (original.type !== "card" || buttonLabels.length !== fields.buttons?.length)) throw new Error("Keep the existing button count when changing labels.");
  if (optionLabels && (original.type !== "choice" || optionLabels.length !== 2)) throw new Error("Choice needs exactly two option labels.");
  return { ...fields, ...text,
    ...(buttonLabels ? { buttons: fields.buttons!.map((button, index) => ({ ...button, label: buttonLabels[index] })) } : {}),
    ...(optionLabels ? { options: fields.options!.map((option, index) => ({ ...option, label: optionLabels[index] })) } : {}),
  };
}

export async function applyComponentOperation(project: ProjectSnapshot, scene: Scene, operation: ComponentOperation, options: NativePreparation): Promise<Scene> {
  const original = operation.kind === "component.add"
    ? createDefaultComponent(`component-${options.createId()}`, operation.componentType, scene, operation.at)
    : scene.components.find(component => component.id === operation.componentId);
  if (!original) throw new Error("The requested component no longer exists in this scene.");
  if (operation.kind === "component.delete") return { ...scene, components: scene.components.filter(component => component.id !== original.id) };
  if (isVisualEditingBlocked(original)) throw new Error("Finish or discard this component's source draft before editing it with the assistant.");
  let next = original;
  if (operation.kind === "component.add") next = changeComponent(original, {
    at: operation.at, dur: operation.duration,
    ...(operation.responsePolicy ? { responsePolicy: { ...operation.responsePolicy } } : {}),
  }, scene);
  if (operation.kind === "component.update") {
    const { duration, scale, scaleX, scaleY, width, height, ...changes } = operation.changes;
    const geometry = {
      ...(scaleX === null ? { scaleX: undefined } : {}),
      ...(scaleY === null ? { scaleY: undefined } : {}),
      ...(width === undefined ? {} : { width: width ?? undefined }),
      ...(height === undefined ? {} : { height: height ?? undefined }),
    };
    next = changeComponent(original, {
      ...changes,
      ...geometry,
      ...(scale === undefined ? {} : scaleComponentUniformly({ ...original, ...geometry }, scale)),
      ...(scaleX === undefined ? {} : { scaleX: scaleX ?? undefined }),
      ...(scaleY === undefined ? {} : { scaleY: scaleY ?? undefined }),
      ...(duration === undefined ? {} : { dur: duration }),
    }, scene);
  }
  if (operation.kind === "component.content") next = changeComponent(original, { fields: contentFields(original, operation.changes) }, scene);
  const source = operation.kind === "component.style"
    ? { ...componentLanguageSource(original), style: operation.style }
    : operation.kind === "component.source" || operation.kind === "component.add" ? operation.source : undefined;
  if (source) next = { ...next, code: { custom: true, pvoTouched: true, pvoLiteral: true, pvo: { ...source } } };
  if (source || operation.kind === "component.content" || operation.kind === "component.add") {
    const originalCompiled = await options.compile(original.type, componentLanguageSource(original));
    const nextSource = componentLanguageSource(next);
    const compiled = await options.compile(next.type, nextSource);
    validateEditableLanguage(compiled);
    const sceneAfter = { ...scene, components: [...scene.components.filter(item => item.id !== next.id), next] };
    const context = { currentSceneId: scene.id, duration: sceneDuration(sceneAfter),
      scenes: project.scenes.map(item => item.id === scene.id ? sceneAfter : item)
        .filter(item => sceneDuration(item) > 0).map(item => ({ id: item.id, name: item.name })) };
    if (matchAttachmentOperation(operation, options.attachment)) {
      validateCompiledServiceAttachment(originalCompiled, compiled, options.attachment!, context);
    } else {
      if (!options.advancedEditingEnabled) validateNoCodeAssistantProposal(originalCompiled, compiled);
      validateCompiledAssistantProposal(originalCompiled, compiled, context);
    }
    validateAssistantContext(compiled, { duration: context.duration, sceneIds: context.scenes.map(item => item.id) });
    const formatted = source ? await preparePvoFormatting(next.type, nextSource, options.compile, compiled, operation.kind === "component.style" ? ["style"] : undefined) : null;
    if (next.code) next = { ...next, ...compiledComponentChanges(next, formatted?.source ?? nextSource, formatted?.compiled ?? compiled) };
  }
  return { ...scene, components: operation.kind === "component.add" ? [...scene.components, next]
    : scene.components.map(component => component.id === original.id ? next : component) };
}

/** Later operations can change timing or remove route targets; check the final project too. */
export function validateNativeComponentRoutes(project: ProjectSnapshot): void {
  for (const scene of project.scenes) for (const component of scene.components) {
    assertResponsePolicyContract([component]);
    if (acceptsResponse(component) && responsePolicyFor(component).unanswered === "pause"
      && component.type === "card" && !fieldsShownFor(component).buttons?.length) {
      throw new Error("A Message needs a button before it can pause for a response.");
    }
    validateAssistantContext(componentLanguageModel(component), {
      duration: sceneDuration(scene), sceneIds: project.scenes.filter(item => sceneDuration(item) > 0).map(item => item.id),
    });
  }
}

/** Recheck the current editing preference against the entire reviewed change, including follow-ups. */
export function validateNativeBatchEditingMode(
  batch: Pick<import("./types").NativeBatch, "before" | "project" | "attachment">,
  advanced: boolean,
): void {
  validateNativeBatchAttachment(batch);
  if (advanced) return;
  const originals = new Map(batch.before.scenes.flatMap(scene => scene.components.map(component => [component.id, component] as const)));
  for (const scene of batch.project.scenes) for (const component of scene.components) {
    if (batch.attachment?.sceneId === scene.id && batch.attachment.componentId === component.id) continue;
    const original = originals.get(component.id);
    validateNoCodeAssistantProposal(original ? componentLanguageModel(original) : { rules: [] }, componentLanguageModel(component));
  }
}
