import { object, requireTask } from "../tasks/validation.js";
import {
  validateServiceConnectionProposal,
  matchServiceAttachment,
} from "./command.js";
import { parseServiceAttachmentReceipt } from "./receipt.js";
import { validateAttachmentInput } from "./input.js";
import { platformOrigin, declarativeServiceRequest } from "./policy.js";
import { canonicalJson } from "../services/json.js";

/** Saved project data, not authority to invoke or activate a release. Retain expired receipts for recovery. */
export function parseComponentServiceConnection(value) {
  object(
    value,
    ["receipt", "connection", "origin"],
    "Component service connection",
  );
  const receipt = parseServiceAttachmentReceipt(value.receipt);
  validateServiceConnectionProposal(value.connection);
  requireTask(
    value.connection.releaseId === receipt.identity.resourceId &&
      value.connection.operation === receipt.operation.name,
    "Component connection does not match its release and operation.",
  );
  validateAttachmentInput(value.connection.input, receipt.operation.input);
  platformOrigin(value.origin);
  return structuredClone(value);
}

export function prepareComponentServiceConnection(authorization) {
  const { command, receipt } = matchServiceAttachment(
    authorization.command,
    authorization.receipt,
    authorization.scope,
    authorization.now,
  );
  return parseComponentServiceConnection({
    receipt,
    connection: command.connection,
    origin: authorization.origin,
  });
}

/** Match only the saved declarative request. Input/action IDs are supplied later by trusted host code. */
export function matchesComponentServiceRequest(value, request) {
  const saved = parseComponentServiceConnection(value);
  const expected = declarativeServiceRequest(
    saved.origin,
    saved.receipt.identity.serviceId,
    saved.receipt.operation.name,
    saved.connection.input,
  );
  return (
    request.url === expected.url &&
    request.method === expected.method &&
    typeof request.body === "string" &&
    canonicalJson(JSON.parse(request.body)) === expected.body
  );
}
