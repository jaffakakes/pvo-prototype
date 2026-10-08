import {
  object,
  id,
  text,
  list,
  unique,
  choice,
  integer,
  boundedJson,
} from "../tasks/validation.js";

/** Safe account metadata only. Trusted account setup owns writes; models receive this closed shape. */
export function parseConnectionMetadata(value) {
  object(
    value,
    [
      "id",
      "name",
      "provider",
      "status",
      "revision",
      "permissions",
      "operations",
    ],
    "Connection metadata",
  );
  id(value.id, "Connection ID");
  text(value.name, 200, "Connection name");
  text(value.provider, 200, "Connection provider");
  choice(
    value.status,
    ["connected", "expired", "revoked"],
    "Connection status",
  );
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Connection revision", 1);
  list(value.permissions, 32, "Connection permissions");
  value.permissions.forEach((permission) =>
    text(permission, 300, "Permission"),
  );
  unique(value.permissions, "Connection permissions");
  list(value.operations, 32, "Installed adapter operations");
  for (const operation of value.operations) {
    object(operation, ["id", "permissions"], "Installed adapter operation");
    id(operation.id, "Adapter operation ID");
    list(operation.permissions, 32, "Required permissions");
    operation.permissions.forEach((permission) =>
      text(permission, 300, "Permission"),
    );
    unique(operation.permissions, "Required permissions");
  }
  unique(
    value.operations.map((operation) => operation.id),
    "Adapter operations",
  );
  boundedJson(value, 8000, "Connection metadata");
  return structuredClone(value);
}

export function parseConnectionPage(value) {
  object(value, ["connections", "next", "version"], "Available connections");
  integer(value.version, Number.MAX_SAFE_INTEGER, "Connection catalog version");
  list(value.connections, 4, "Connection page");
  value.connections.forEach(parseConnectionMetadata);
  unique(
    value.connections.map((connection) => connection.id),
    "Connection page",
  );
  if (value.next !== null) id(value.next, "Next connection cursor");
  return structuredClone(value);
}

export {
  parseConnectionSetup,
  parseConnectionInvocation,
  GITHUB_OPERATIONS,
} from "./setup.js";
