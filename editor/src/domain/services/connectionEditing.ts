import { usesTypedFormValues } from "../../../../packages/pvo-assistant/policy.js";
import type {
  CompiledPvoComponent,
  PvoLanguageStructure,
} from "../../../../packages/pvo-language/index.js";
import {
  parseServiceAttachmentCommand,
  serviceAttachmentRequest,
  type ServiceAttachmentAuthorization,
  type ServiceAttachmentReceipt,
  type ServiceInputBinding,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import type { ServiceValueSchema } from "../../../../packages/pvo-assistant/services/index.js";
import type { PvoComponent } from "../project/model";
import { componentLanguageSource } from "../components/languageCompilation";
import { logicSource } from "../components/languageEditing";

export type ConnectionTarget = {
  event: "press" | "choose" | "submit";
  target: string | null;
  label: string;
};
export type ConnectionField = {
  name: string;
  label: string;
  type: "number" | "boolean" | "string";
};
export function connectionFields(
  structure: PvoLanguageStructure,
): ConnectionField[] {
  return structure.type !== "form"
    ? []
    : structure.fields.map((field) => ({
        name: field.name,
        label: field.label ?? field.name,
        type:
          field.kind === "number"
            ? "number"
            : field.kind === "yesno" && usesTypedFormValues(structure)
              ? "boolean"
              : "string",
      }));
}
export function connectionTargets(
  compiled: CompiledPvoComponent,
): ConnectionTarget[] {
  const structure = compiled.structure;
  const targets: ConnectionTarget[] =
    structure.type === "tooltip"
      ? []
      : structure.type === "form"
        ? [{ event: "submit", target: null, label: structure.submit }]
        : (structure.type === "card"
            ? structure.buttons
            : structure.options
          ).map((control) => ({
            event: structure.type === "card" ? "press" : "choose",
            target: control.id,
            label: control.label,
          }));
  return targets.filter(
    (target) =>
      !compiled.rules.some(
        (rule) =>
          rule.event === target.event &&
          rule.target === target.target &&
          rule.action.kind === "request",
      ),
  );
}
export function matchingConnectionFields(
  schema: ServiceValueSchema,
  fields: ConnectionField[],
) {
  const type =
    schema.type === "integer"
      ? "number"
      : schema.type === "enum"
        ? "string"
        : schema.type;
  return fields.filter((field) => field.type === type);
}
export function defaultInputBinding(
  schema: ServiceValueSchema,
  fields: ConnectionField[] = [],
  name = "",
): ServiceInputBinding {
  if (schema.type === "object")
    return {
      kind: "object",
      fields: schema.fields.map((field) => ({
        name: field.name,
        value: defaultInputBinding(field.schema, fields, field.name),
      })),
    };
  const matching = matchingConnectionFields(schema, fields);
  const match =
    matching.find((field) => field.name === name) ??
    (matching.length === 1 ? matching[0] : null);
  if (match) return { kind: "field", name: match.name };
  switch (schema.type) {
    case "array":
      return { kind: "literal", value: [] };
    case "null":
      return { kind: "literal", value: null };
    case "boolean":
      return { kind: "literal", value: false };
    case "enum":
      return { kind: "literal", value: schema.values[0] };
    case "integer":
    case "number":
      return { kind: "literal", value: schema.minimum };
    default:
      return { kind: "literal", value: "" };
  }
}
/** Preserve Structure/Style and unrelated rules; only the chosen control gains a checked request. */
export function proposeContainerConnection(
  component: PvoComponent,
  sceneId: string,
  compiled: CompiledPvoComponent,
  receipt: ServiceAttachmentReceipt,
  target: ConnectionTarget,
  input: ServiceInputBinding,
  origin: string,
  now: number,
): ServiceAttachmentAuthorization {
  if (
    !connectionTargets(compiled).some(
      (item) => item.event === target.event && item.target === target.target,
    )
  )
    throw new Error(
      "Choose a control without an existing request. Change its current action first if you want to replace it.",
    );
  const source = componentLanguageSource(component);
  const scope = {
    ownerId: receipt.identity.ownerId,
    projectId: receipt.identity.projectId,
    taskId: receipt.identity.taskId,
  };
  const authorization: ServiceAttachmentAuthorization = {
    receipt,
    scope,
    origin,
    now,
    command: {
      kind: "service.attach",
      component: {
        kind: "component.source",
        sceneId,
        componentId: component.id,
        source,
      },
      connection: {
        releaseId: receipt.identity.resourceId,
        operation: receipt.operation.name,
        event: target.event,
        target: target.target,
        input,
      },
    },
  };
  const previous = compiled.rules.find(
    (rule) => rule.event === target.event && rule.target === target.target,
  );
  const rule = {
    event: target.event,
    target: target.target,
    action: {
      kind: "request" as const,
      ...serviceAttachmentRequest(authorization),
      onSuccess:
        previous && previous.action.kind !== "request"
          ? previous.action
          : { kind: "continue" as const },
      onError: null,
    },
  };
  const rules = [...compiled.rules.filter((item) => item !== previous), rule];
  authorization.command.component.source = {
    ...source,
    logic: logicSource(rules),
  };
  authorization.command = parseServiceAttachmentCommand(authorization.command);
  return authorization;
}
