import {
  parseServiceIdentity,
  parseServiceObservation,
  parseServicePublication,
} from "../releases/index.js";
import { parseServiceOperation } from "../services/index.js";
import { choice, object, requireTask, time } from "../tasks/validation.js";

/** Parsing validates data, not its provenance. Only the trusted saved-task transport supplies receipts. */
export function parseServiceAttachmentReceipt(value) {
  object(
    value,
    ["identity", "operation", "readiness"],
    "Service attachment receipt",
  );
  const identity = parseServiceIdentity(value.identity);
  const operation = parseServiceOperation(value.operation);
  requireTask(
    operation.audience === "public",
    "Components can attach only public service operations.",
  );
  object(
    value.readiness,
    ["state", "observedAt"],
    "Service attachment readiness",
  );
  choice(
    value.readiness.state,
    ["available", "retained"],
    "Service attachment readiness",
  );
  time(value.readiness.observedAt, "Service observation time");
  requireTask(
    value.readiness.state === "retained" ||
      value.readiness.observedAt < identity.expiresAt,
    "The inactive service release has expired.",
  );
  return { identity, operation, readiness: { ...value.readiness } };
}

/** The adapter supplies independently verified bytes and the actual private provider observation. */
export function prepareServiceAttachmentReceipt(
  publication,
  observation,
  operationName,
  now,
) {
  const checked = parseServicePublication(publication);
  const observed = parseServiceObservation(observation, checked.identity);
  const operation = checked.artifact.agreement.operations.find(
    (item) => item.name === operationName,
  );
  requireTask(operation, "The checked service has no matching operation.");
  return parseServiceAttachmentReceipt({
    identity: checked.identity,
    operation,
    readiness: { state: observed.state, observedAt: now },
  });
}
