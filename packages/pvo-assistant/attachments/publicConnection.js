import { object, boundedJson } from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { validateServiceConnectionProposal } from "./command.js";
import { validateAttachmentInput } from "./input.js";
import { parseComponentServiceConnection } from "./component.js";
import {
  declarativeServiceRequest,
  matchesDeclarativeServiceRequest,
} from "./policy.js";
import {
  parseServiceSubmissionTarget,
  resolveBoundSubmissionInput,
} from "./submissions.js";

function targetFields(value) {
  return {
    origin: value.origin,
    serviceId: value.serviceId,
    releaseId: value.releaseId,
    operation: value.operation,
    mode: "public",
    ownerId: null,
  };
}

/** Portable invocation data. Parsing cannot activate hosting or grant creator permissions. */
export function parsePublicServiceConnection(value) {
  object(
    value,
    [
      "origin",
      "serviceId",
      "releaseId",
      "operation",
      "event",
      "target",
      "input",
    ],
    "Public service connection",
  );
  const target = parseServiceSubmissionTarget(targetFields(value));
  validateServiceConnectionProposal({
    releaseId: target.releaseId,
    operation: target.operation.name,
    event: value.event,
    target: value.target,
    input: value.input,
  });
  validateAttachmentInput(value.input, target.operation.input);
  boundedJson(
    value,
    SERVICE_PACKAGE_LIMITS.envelopeBytes,
    "Public service connection",
  );
  return structuredClone(value);
}

/** Explicit allowlist projection; callers still need the separate activation/delivery command. */
export function projectPublicServiceConnection(value) {
  const saved = parseComponentServiceConnection(value);
  return parsePublicServiceConnection({
    origin: saved.origin,
    serviceId: saved.receipt.identity.serviceId,
    releaseId: saved.connection.releaseId,
    operation: saved.receipt.operation,
    event: saved.connection.event,
    target: saved.connection.target,
    input: saved.connection.input,
  });
}

export function publicServiceSubmissionTarget(value) {
  return parseServiceSubmissionTarget(
    targetFields(parsePublicServiceConnection(value)),
  );
}

export function resolvePublicServiceSubmissionInput(value, fields) {
  const saved = parsePublicServiceConnection(value);
  return resolveBoundSubmissionInput(
    saved.input,
    saved.operation.input,
    fields,
  );
}

export function matchesPublicServiceRequest(value, request) {
  const saved = parsePublicServiceConnection(value);
  return matchesDeclarativeServiceRequest(
    declarativeServiceRequest(
      saved.origin,
      saved.serviceId,
      saved.operation.name,
      saved.input,
    ),
    request,
  );
}
