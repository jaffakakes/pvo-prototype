import { object, id, integer, choice, list } from "../tasks/validation.js";
import { canonicalJson } from "../services/json.js";
import {
  parseServiceObservation,
  SERVICE_CATALOG_LIMITS,
} from "../releases/index.js";
import { parseHostedService } from "./service.js";
import { serviceCallError } from "./actions.js";

export const SERVICE_CONTROL_RECEIPTS = 64;
export function parseServiceControl(value) {
  choice(value?.kind, ["activate", "pause", "delete"], "Service control");
  object(
    value,
    value.kind === "activate"
      ? ["kind", "actionId", "expectedRevision", "releaseId"]
      : ["kind", "actionId", "expectedRevision"],
    "Service control",
  );
  id(value.actionId, "Service control ID");
  integer(
    value.expectedRevision,
    Number.MAX_SAFE_INTEGER,
    "Expected service revision",
  );
  if (value.kind === "activate") id(value.releaseId, "Service release ID");
  return structuredClone(value);
}
export const serializeServiceControl = (value) =>
  canonicalJson(parseServiceControl(value));
export function planServiceControl(service, control, now) {
  service = parseHostedService(service);
  control = parseServiceControl(control);
  if (control.expectedRevision !== service.revision)
    throw serviceCallError(
      "state_changed",
      "This service changed. Refresh its status before trying again.",
    );
  if (service.state === "deleted" && control.kind !== "delete")
    throw serviceCallError("unavailable", "This service has been deleted.");
  let state = service.state,
    liveReleaseId = service.liveReleaseId,
    testReleaseId = service.testReleaseId;
  if (control.kind === "activate") {
    if (liveReleaseId !== null && liveReleaseId !== control.releaseId)
      throw serviceCallError(
        "invalid_input",
        "Replacing the active release is not available yet.",
      );
    state = "active";
    liveReleaseId = control.releaseId;
  } else if (control.kind === "pause") {
    if (liveReleaseId === null)
      throw serviceCallError(
        "invalid_input",
        "This service has not been activated.",
      );
    state = "paused";
  } else {
    state = "deleted";
    liveReleaseId = null;
    testReleaseId = null;
  }
  return parseHostedService({
    ...service,
    state,
    liveReleaseId,
    testReleaseId,
    revision: service.revision + 1,
    updatedAt: now,
  });
}
export function parseHostedSummary(value) {
  object(value, ["service", "releases"], "Hosted service summary");
  const service = parseHostedService(value.service);
  list(
    value.releases,
    SERVICE_CATALOG_LIMITS.releases,
    "Hosted release summary",
  );
  const releases = value.releases.map((item) => {
    const result = parseServiceObservation(item, item.identity);
    if (
      ["serviceId", "ownerId", "projectId"].some(
        (key) => result.identity[key] !== service.identity[key],
      )
    )
      throw new Error("Hosted release ownership conflicts.");
    return result;
  });
  if (
    new Set(releases.map((item) => item.identity.resourceId)).size !==
    releases.length
  )
    throw new Error("Repeated hosted release identity.");
  return { service, releases };
}
