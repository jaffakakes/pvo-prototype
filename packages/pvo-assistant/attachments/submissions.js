import {
  parseJobReceipt,
  receiptFinished,
  advanceJobReceipt,
} from "../jobs/index.js";
import {
  parseServiceOperation,
  SERVICE_PACKAGE_LIMITS,
} from "../services/index.js";
import { boundedValue } from "../services/values.js";
import { canonicalJson } from "../services/json.js";
import {
  parseServiceAction,
  serializeServiceAction,
} from "../hosting/index.js";
import {
  boundedJson,
  choice,
  id,
  object,
  requireTask,
} from "../tasks/validation.js";
import { parseComponentServiceConnection } from "./component.js";
import { platformOrigin } from "./policy.js";

/** A client checkpoint scope, never permission to call the service or select its active release. */
export function parseServiceSubmissionTarget(value) {
  object(
    value,
    ["origin", "serviceId", "releaseId", "operation", "mode", "ownerId"],
    "Submission target",
  );
  platformOrigin(value.origin);
  requireTask(
    typeof value.serviceId === "string" &&
      /^service-[a-f0-9]{64}$/.test(value.serviceId),
    "Submission service ID is invalid.",
  );
  requireTask(
    typeof value.releaseId === "string" &&
      /^release-[a-f0-9]{64}$/.test(value.releaseId),
    "Submission release ID is invalid.",
  );
  const operation = parseServiceOperation(value.operation);
  requireTask(
    operation.audience === "public",
    "Components can invoke only public operations.",
  );
  choice(value.mode, ["try", "public"], "Submission mode");
  if (value.mode === "try") id(value.ownerId, "Try account");
  else
    requireTask(
      value.ownerId === null,
      "Public submissions do not contain a creator account.",
    );
  boundedJson(value, SERVICE_PACKAGE_LIMITS.envelopeBytes, "Submission target");
  return structuredClone(value);
}

export function prepareServiceSubmissionTarget(value, scope) {
  const saved = parseComponentServiceConnection(value);
  object(scope, ["mode", "ownerId"], "Submission scope");
  requireTask(
    scope.mode !== "try" || scope.ownerId === saved.receipt.identity.ownerId,
    "Try connection belongs to a different account.",
  );
  return parseServiceSubmissionTarget({
    origin: saved.origin,
    serviceId: saved.receipt.identity.serviceId,
    releaseId: saved.connection.releaseId,
    operation: saved.receipt.operation,
    mode: scope.mode,
    ownerId: scope.ownerId,
  });
}

function resolveBinding(binding, fields) {
  if (binding.kind === "literal") return structuredClone(binding.value);
  if (binding.kind === "field") {
    const field = Object.getOwnPropertyDescriptor(fields, binding.name);
    requireTask(
      field?.enumerable && "value" in field,
      `Service input needs form field ${binding.name}.`,
    );
    return field.value;
  }
  if (binding.kind === "array")
    return binding.items.map((item) => resolveBinding(item, fields));
  return Object.fromEntries(
    binding.fields.map((item) => [
      item.name,
      resolveBinding(item.value, fields),
    ]),
  );
}

/** Resolve already typed host form values. Strings are never coerced into numbers or booleans. */
export function resolveServiceSubmissionInput(value, fields) {
  const saved = parseComponentServiceConnection(value);
  return resolveBoundSubmissionInput(
    saved.connection.input,
    saved.receipt.operation.input,
    fields,
  );
}

/** Shared internal data rule for private authoring and public playback descriptors. */
export function resolveBoundSubmissionInput(binding, schema, fields) {
  requireTask(
    fields !== null &&
      typeof fields === "object" &&
      !Array.isArray(fields) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(fields)),
    "Form values must be an object.",
  );
  const input = resolveBinding(binding, fields);
  boundedValue(
    schema,
    input,
    SERVICE_PACKAGE_LIMITS.inputBytes,
    "Service input",
  );
  return structuredClone(input);
}

export const backgroundSubmission = (target) =>
  target.mode === "public" && target.operation.delivery === "background";
export const submissionFinished = (saved) =>
  saved.response !== null &&
  (saved.target.operation.delivery !== "background" ||
    receiptFinished(saved.response));

function checkResponse(target, action, response) {
  if (target.operation.delivery === "background") {
    parseJobReceipt(response, action.actionId, target.operation.result);
    return;
  }
  object(response, ["actionId", "result"], "Submission response");
  requireTask(
    response.actionId === action.actionId,
    "The service response belongs to another action.",
  );
  boundedValue(
    target.operation.result,
    response.result,
    SERVICE_PACKAGE_LIMITS.resultBytes,
    "Service result",
  );
}

/** Restore a saved client intent. Parsing a locally edited record grants no server authority. */
export function parseServiceSubmission(value) {
  object(
    value,
    [
      "target",
      "action",
      "response",
      ...(backgroundSubmission(value.target ?? {}) ? ["receiptKey"] : []),
    ],
    "Service submission",
  );
  if (backgroundSubmission(value.target ?? {}))
    requireTask(
      /^[a-f0-9]{64}$/.test(value.receiptKey),
      "A background submission needs a private random receipt key.",
    );
  const target = parseServiceSubmissionTarget(value.target);
  object(value.action, ["actionId", "operation", "input"], "Submission action");
  boundedValue(
    target.operation.input,
    value.action.input,
    SERVICE_PACKAGE_LIMITS.inputBytes,
    "Service input",
  );
  const action = parseServiceAction(value.action);
  requireTask(
    action.operation === target.operation.name,
    "Submission operation changed.",
  );
  if (value.response !== null) checkResponse(target, action, value.response);
  boundedJson(value, 96 * 1024, "Service submission");
  return structuredClone(value);
}

/** Internal capture before asynchronous storage; validates data without generating a new identity. */
export function snapshotSubmissionInput(target, input) {
  target = parseServiceSubmissionTarget(target);
  boundedValue(
    target.operation.input,
    input,
    SERVICE_PACKAGE_LIMITS.inputBytes,
    "Service input",
  );
  return { target, input: structuredClone(input) };
}

/** The host generates a fresh unpredictable ID for each distinct submission, then persists this before sending. */
export function prepareServiceSubmission(target, input, actionId, receiptKey) {
  target = parseServiceSubmissionTarget(target);
  return parseServiceSubmission({
    target,
    action: { actionId, operation: target.operation.name, input },
    response: null,
    ...(backgroundSubmission(target) ? { receiptKey } : {}),
  });
}

/** Retry restores the original input. A changed form is a separate intent and must not rewrite this checkpoint. */
export function retryServiceSubmission(value, currentTarget) {
  const submission = parseServiceSubmission(value);
  requireTask(
    canonicalJson(submission.target) ===
      canonicalJson(parseServiceSubmissionTarget(currentTarget)),
    "The saved submission belongs to another connection or account.",
  );
  return submission;
}

export function completeServiceSubmission(value, response) {
  const submission = parseServiceSubmission(value);
  checkResponse(submission.target, submission.action, response);
  requireTask(
    submission.target.operation.delivery === "background" ||
      submission.response === null ||
      canonicalJson(submission.response) === canonicalJson(response),
    "A completed submission cannot change its result.",
  );
  return {
    ...submission,
    response:
      submission.target.operation.delivery === "background"
        ? advanceJobReceipt(submission.response, structuredClone(response))
        : structuredClone(response),
  };
}

/** Same canonical bytes on every attempt. The host adapter supplies transport, cancellation and credentials. */
export function serviceSubmissionRequest(value) {
  const submission = parseServiceSubmission(value);
  requireTask(
    submission.response === null || backgroundSubmission(submission.target),
    "This submission already has a saved response.",
  );
  const { target, action } = submission;
  if (backgroundSubmission(target)) {
    const checking = submission.response !== null;
    return {
      url: `${target.origin}/api/services/${target.serviceId}/${checking ? "job-receipt" : "jobs"}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: canonicalJson(
        checking
          ? { actionId: action.actionId, receiptKey: submission.receiptKey }
          : {
              releaseId: target.releaseId,
              action,
              receiptKey: submission.receiptKey,
              schedule: null,
            },
      ),
    };
  }
  return {
    url: `${target.origin}/api/services/${target.serviceId}/${target.mode === "try" ? `releases/${target.releaseId}/try` : "actions"}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serializeServiceAction(action),
  };
}

export function serviceJobReceiptRequest(value) {
  const saved = parseServiceSubmission(value);
  requireTask(
    backgroundSubmission(saved.target),
    "This action has no background receipt.",
  );
  return {
    url: `${saved.target.origin}/api/services/${saved.target.serviceId}/job-receipt`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: canonicalJson({
      actionId: saved.action.actionId,
      receiptKey: saved.receiptKey,
    }),
  };
}
