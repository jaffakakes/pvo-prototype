import { object, text, requireTask, id, integer } from "../tasks/validation.js";

export const GITHUB_OPERATIONS = Object.freeze([
  { id: "github_repository_read", permissions: ["repository:read"] },
  { id: "github_issues_list", permissions: ["issues:read"] },
]);

/** Scope is chosen by the creator and stored by the platform, never an invocation URL. */
export function parseConnectionSetup(value) {
  object(
    value,
    [
      "provider",
      "repository",
      ...(Object.hasOwn(value, "access") ? ["access"] : []),
    ],
    "Connection setup",
  );
  if (Object.hasOwn(value, "access"))
    requireTask(
      value.access === "issues_write",
      "Unsupported account permission.",
    );
  requireTask(
    value.provider === "github",
    "This provider has no installed connection adapter.",
  );
  text(value.repository, 140, "GitHub repository");
  requireTask(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(
      value.repository,
    ) && !/[/.]\.($|\/)/.test(value.repository),
    "Use a GitHub owner/repository name.",
  );
  return {
    provider: "github",
    repository: value.repository.toLowerCase(),
    ...(value.access ? { access: value.access } : {}),
  };
}

export function parseConnectionInvocation(value) {
  object(value, ["operation", "input"], "Connection operation");
  id(value.operation, "Connection operation");
  requireTask(
    GITHUB_OPERATIONS.some((item) => item.id === value.operation),
    "This connection operation is not installed.",
  );
  if (value.operation === "github_repository_read")
    object(value.input, [], "Repository read");
  else {
    object(value.input, ["page"], "Issue list");
    integer(value.input.page, 1000, "Issue page", 1);
  }
  return structuredClone(value);
}
