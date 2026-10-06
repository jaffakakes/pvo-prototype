import { canonicalJson } from "../services/json.js";
import { requireTask } from "../tasks/validation.js";
import {
  usesTypedFormValues,
  validateCompiledAssistantOriginal,
  validateCompiledAssistantProposal,
} from "../policy.js";
import { matchServiceAttachment } from "./command.js";

/** This origin is platform configuration; it must never come from the model's connection proposal. */
export function platformOrigin(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  requireTask(
    url.origin === value &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || (loopback && url.protocol === "http:")),
    "A fixed platform origin is required for service attachment.",
  );
  return url.origin;
}

export function serviceAttachmentRequest(authorization) {
  const { command, receipt } = matchServiceAttachment(
    authorization.command,
    authorization.receipt,
    authorization.scope,
    authorization.now,
  );
  return declarativeServiceRequest(
    authorization.origin,
    receipt.identity.serviceId,
    receipt.operation.name,
    command.connection.input,
  );
}

/** Shared projection for admission and later invocation matching; never an executable action. */
export function declarativeServiceRequest(origin, serviceId, operation, input) {
  return {
    url: `${platformOrigin(origin)}/api/services/${serviceId}/actions`,
    method: "POST",
    body: canonicalJson({ operation, input }),
  };
}

/** Compare the declarative envelope before granting its host-owned invocation adapter. */
export function matchesDeclarativeServiceRequest(expected, request) {
  return (
    request.url === expected.url &&
    request.method === expected.method &&
    typeof request.body === "string" &&
    canonicalJson(JSON.parse(request.body)) === expected.body
  );
}

/** One narrow capability supplied separately from native model output; no broad request-policy bypass. */
export function matchAttachmentOperation(operation, authorization) {
  if (!authorization) return null;
  const value = matchServiceAttachment(
    authorization.command,
    authorization.receipt,
    authorization.scope,
    authorization.now,
  );
  platformOrigin(authorization.origin);
  return canonicalJson(operation) === canonicalJson(value.command.component)
    ? value
    : null;
}

export function validateServiceBindingFields(binding, schema, structure) {
  if (binding.kind === "field") {
    requireTask(
      structure.type === "form",
      "Only form components can bind form inputs.",
    );
    const field = structure.fields.find((item) => item.name === binding.name);
    requireTask(field, "Service input refers to a missing form field.");
    const type =
      field.kind === "number"
        ? "number"
        : field.kind === "yesno" && usesTypedFormValues(structure)
          ? "boolean"
          : "string";
    requireTask(
      type === schema.type ||
        (type === "number" && schema.type === "integer") ||
        (type === "string" && schema.type === "enum"),
      "Form field type does not match the service input.",
    );
  } else if (binding.kind === "object") {
    for (const field of binding.fields)
      validateServiceBindingFields(
        field.value,
        schema.fields.find((item) => item.name === field.name).schema,
        structure,
      );
  } else if (binding.kind === "array") {
    for (const item of binding.items)
      validateServiceBindingFields(item, schema.items, structure);
  } else {
    requireTask(
      !/\{(?:state|response)\./.test(JSON.stringify(binding.value)),
      "Literal service inputs cannot contain PVO state templates.",
    );
  }
}

/** Both arguments must be actual compiler output. The authorized source change is still checked against its original. */
export function validateCompiledServiceAttachment(
  original,
  proposed,
  authorization,
  context,
) {
  const { command, receipt } = matchServiceAttachment(
    authorization.command,
    authorization.receipt,
    authorization.scope,
    authorization.now,
  );
  const connection = command.connection;
  validateCompiledAssistantOriginal(proposed, context);
  const matches = proposed.rules.filter(
    (rule) =>
      rule.event === connection.event && rule.target === connection.target,
  );
  requireTask(
    matches.length === 1 && matches[0].action.kind === "request",
    "The attached control needs exactly one checked service request.",
  );
  const rule = matches[0],
    action = rule.action;
  const expected = serviceAttachmentRequest(authorization);
  requireTask(
    action.url === expected.url &&
      action.method === expected.method &&
      canonicalJson(JSON.parse(action.body)) === expected.body,
    "The attached request does not match its verified service connection.",
  );
  validateServiceBindingFields(
    connection.input,
    receipt.operation.input,
    proposed.structure,
  );
  const before = original?.rules.find(
    (item) => item.event === rule.event && item.target === rule.target,
  );
  requireTask(
    before?.action.kind !== "request" ||
      canonicalJson(before.action) === canonicalJson(action),
    "A service attachment cannot replace an existing request.",
  );
  const masked = {
    ...proposed,
    rules: proposed.rules.map((item) =>
      item === rule
        ? { ...item, action: before?.action ?? { kind: "continue" } }
        : item,
    ),
  };
  validateCompiledAssistantProposal(
    original ?? { ...proposed, rules: [] },
    masked,
    context,
  );
}
