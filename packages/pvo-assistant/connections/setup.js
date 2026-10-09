import { object, text, requireTask, id, integer } from "../tasks/validation.js";
import { identityResource } from "../identity/index.js";

export const GITHUB_OPERATIONS = Object.freeze([
  { id: "github_repository_read", permissions: ["repository:read"] },
  { id: "github_issues_list", permissions: ["issues:read"] },
]);

/** Scope is chosen by the creator and stored by the platform, never an invocation URL. */
export function parseConnectionSetup(value) {
  if (["agentmail", "agentphone"].includes(value?.provider)) {
    object(value, ["provider", "resourceId"], "Agent identity connection");
    identityResource(value.resourceId);
    return structuredClone(value);
  }
  if (value?.provider === "resend") {
    object(value, ["provider", "from", "recipient"], "Email connection");
    for (const field of ["from", "recipient"]) {
      text(value[field], 254, field);
      requireTask(
        /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
          value[field],
        ),
        "Use an email address without a display name.",
      );
    }
    return {
      provider: "resend",
      from: value.from.toLowerCase(),
      recipient: value.recipient.toLowerCase(),
    };
  }
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

/** Fixed creator-chosen sender and recipient; generated code supplies only bounded subject and text. */
export function connectionScopeKey(value) {
  const scope = parseConnectionSetup(value);
  if (["agentmail", "agentphone"].includes(scope.provider))
    return `${scope.provider}:${scope.resourceId}`;
  return scope.provider === "github"
    ? `github:${scope.repository}`
    : `resend:${scope.from}:${scope.recipient}`;
}
export function parseResendCredential(value) {
  const credential = JSON.parse(value);
  object(credential, ["key", "webhookSecret"], "Private email credential");
  requireTask(
    /^re_[A-Za-z0-9_-]{20,1000}$/.test(credential.key),
    "Invalid Resend key.",
  );
  requireTask(
    credential.webhookSecret === "" ||
      /^whsec_[A-Za-z0-9+/=]{16,200}$/.test(credential.webhookSecret),
    "Invalid webhook secret.",
  );
  return credential;
}
