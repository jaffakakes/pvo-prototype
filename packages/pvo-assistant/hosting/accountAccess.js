import { object, id, choice, text, list, unique } from "../tasks/validation.js";
export function parseServiceAccountAccess(value) {
  object(
    value,
    ["ownerId", "serviceId", "releaseId", "approved", "bindings"],
    "Container account access",
  );
  for (const key of ["ownerId", "serviceId", "releaseId"]) id(value[key], key);
  choice(value.approved, [true, false], "Account approval");
  list(value.bindings, 4, "Requested account bindings");
  for (const item of value.bindings) {
    object(
      item,
      [
        "name",
        "operations",
        "description",
        "permission",
        "method",
        "documentation",
        "repository",
        "account",
        "error",
      ],
      "Requested account access",
    );
    id(item.name, "Binding name");
    list(item.operations, 8, "Service operations");
    for (const operation of item.operations) id(operation, "Service operation");
    text(item.description, 1024, "Access purpose");
    choice(
      item.permission,
      ["repository:read", "issues:read", "issues:write"],
      "Account permission",
    );
    choice(item.method, ["GET", "POST"], "Account request method");
    text(item.documentation, 2048, "Provider documentation");
    for (const key of ["repository", "account", "error"])
      if (item[key] !== null) text(item[key], 1024, key);
  }
  unique(
    value.bindings.map((item) => item.name),
    "Account binding names",
  );
  return structuredClone(value);
}
