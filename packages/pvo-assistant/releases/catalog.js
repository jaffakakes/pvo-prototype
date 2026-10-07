import {
  object,
  id,
  integer,
  text,
  choice,
  list,
  unique,
  requireTask,
} from "../tasks/validation.js";
import { SERVICE_RUNTIME, SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { parseServiceIdentity } from "./identity.js";

export const SERVICE_CATALOG_LIMITS = Object.freeze({
  active: 8,
  identities: 64,
  daily: 8,
  releases: 4,
});
function timestamps(value) {
  integer(value.createdAt, 8640000000000000, "Service creation time", 1);
  integer(
    value.updatedAt,
    8640000000000000,
    "Service update time",
    value.createdAt,
  );
}
export function parseOwnedService(value) {
  object(
    value,
    [
      "identity",
      "description",
      "state",
      "hostRevision",
      "createdAt",
      "updatedAt",
    ],
    "Owned service",
  );
  object(
    value.identity,
    ["serviceId", "ownerId", "projectId"],
    "Service ownership",
  );
  for (const key of Object.keys(value.identity)) id(value.identity[key], key);
  text(value.description, 2048, "Service description");
  choice(
    value.state,
    ["inactive", "active", "paused", "deleted"],
    "Owned service state",
  );
  if (value.hostRevision !== null)
    integer(value.hostRevision, Number.MAX_SAFE_INTEGER, "Hosted revision");
  timestamps(value);
  return structuredClone(value);
}
export function parseOwnedRelease(value) {
  object(
    value,
    ["identity", "runtime", "permissions", "state", "createdAt", "updatedAt"],
    "Owned release",
  );
  parseServiceIdentity(value.identity);
  requireTask(
    value.runtime === SERVICE_RUNTIME,
    "Unsupported service runtime.",
  );
  choice(
    value.state,
    ["pending", "inactive", "retained", "deleted"],
    "Owned release state",
  );
  list(
    value.permissions,
    SERVICE_PACKAGE_LIMITS.operations,
    "Service permissions",
  );
  requireTask(value.permissions.length > 0, "Release permissions are missing.");
  for (const permission of value.permissions) {
    object(permission, ["name", "audience", "access"], "Operation permission");
    id(permission.name, "Operation name");
    choice(permission.audience, ["public", "creator"], "Operation audience");
    choice(permission.access, ["read", "write"], "Operation storage access");
  }
  unique(
    value.permissions.map((permission) => permission.name),
    "Service operation names",
  );
  timestamps(value);
  return structuredClone(value);
}

/** Shared admission for manually created and AI-created service identities. */
export function admitOwnedService(services, now) {
  const day = Math.floor(now / 86400000) * 86400000;
  if (
    services.length >= SERVICE_CATALOG_LIMITS.identities ||
    services.filter((item) => item.state !== "deleted").length >=
      SERVICE_CATALOG_LIMITS.active ||
    services.filter((item) => item.createdAt >= day).length >=
      SERVICE_CATALOG_LIMITS.daily
  )
    throw Object.assign(new Error("Your Container limit has been reached."), {
      code: "budget_exceeded",
    });
}
