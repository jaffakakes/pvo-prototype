import {
  object,
  id,
  integer,
  choice,
  requireTask,
} from "../tasks/validation.js";
import { serviceCallError } from "./actions.js";
export function parseHostedService(value) {
  object(
    value,
    [
      "identity",
      "state",
      "revision",
      "testReleaseId",
      "liveReleaseId",
      "createdAt",
      "updatedAt",
    ],
    "Hosted service",
  );
  object(
    value.identity,
    ["serviceId", "ownerId", "projectId"],
    "Hosted service owner",
  );
  for (const key of Object.keys(value.identity)) id(value.identity[key], key);
  choice(
    value.state,
    ["inactive", "active", "paused", "deleted"],
    "Hosted service state",
  );
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Service revision");
  for (const key of ["testReleaseId", "liveReleaseId"])
    if (value[key] !== null) id(value[key], key);
  integer(value.createdAt, 8640000000000000, "Creation time", 1);
  integer(value.updatedAt, 8640000000000000, "Update time", value.createdAt);
  requireTask(
    !["active", "paused"].includes(value.state) || value.liveReleaseId !== null,
    "Active service requires a release.",
  );
  return structuredClone(value);
}
export function newHostedService(identity, now) {
  const { serviceId, ownerId, projectId } = identity;
  return parseHostedService({
    identity: { serviceId, ownerId, projectId },
    state: "inactive",
    revision: 0,
    testReleaseId: null,
    liveReleaseId: null,
    createdAt: now,
    updatedAt: now,
  });
}
export function selectTestRelease(service, releaseId, now) {
  return parseHostedService({
    ...service,
    testReleaseId: releaseId,
    revision: service.revision + 1,
    updatedAt: now,
  });
}
/** Authority is supplied by trusted routes, never parsed from the action's JSON. */
export function serviceCallScope(service, authority) {
  if (!service || service.state === "deleted")
    throw serviceCallError("unavailable", "This service is unavailable.");
  if (authority.kind === "public") {
    if (service.state !== "active")
      throw serviceCallError(
        "unavailable",
        "This service is not accepting actions.",
      );
    return {
      namespace: "live",
      releaseId: service.liveReleaseId,
      audience: "public",
    };
  }
  if (authority.kind === "component_test") {
    if (
      authority.ownerId !== service.identity.ownerId ||
      !service.testReleaseId ||
      authority.releaseId !== service.testReleaseId
    )
      throw serviceCallError(
        "unavailable",
        "This component test connection is unavailable.",
      );
    return {
      namespace: "test",
      releaseId: service.testReleaseId,
      audience: "public",
    };
  }
  if (
    authority.kind !== "creator" ||
    authority.ownerId !== service.identity.ownerId
  )
    throw serviceCallError("unavailable", "This service is unavailable.");
  if (authority.mode === "test" && service.testReleaseId)
    return {
      namespace: "test",
      releaseId: service.testReleaseId,
      audience: "creator",
    };
  if (authority.mode === "live" && service.state === "active")
    return {
      namespace: "live",
      releaseId: service.liveReleaseId,
      audience: "creator",
    };
  throw serviceCallError(
    "unavailable",
    "This service is not accepting actions.",
  );
}
