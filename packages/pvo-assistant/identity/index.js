import {
  object,
  choice,
  integer,
  text,
  requireTask,
} from "../tasks/validation.js";

export const IDENTITY_PROVIDERS = Object.freeze(["agentmail", "agentphone"]);
export const IDENTITY_STATUSES = Object.freeze([
  "starting",
  "awaiting_verification",
  "verifying",
  "ready",
  "needs_attention",
  "disconnected",
]);

export function identityEmail(value) {
  text(value, 254, "Owner email");
  requireTask(
    /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
      value,
    ),
    "Use an email address without a display name.",
  );
  return value.toLowerCase();
}

export function identityResource(value) {
  text(value, 254, "Identity resource");
  requireTask(/^[A-Za-z0-9_@.+-]+$/.test(value), "Invalid identity resource.");
  return value;
}

export function identityCredential(value) {
  text(value, 2048, "Private provider key");
  requireTask(
    /^[A-Za-z0-9_.-]{20,2048}$/.test(value),
    "Invalid private provider key.",
  );
  return value;
}

/** Safe identity status is separate from private keys, owner email and verification handles. */
export function parseIdentityChannel(value) {
  object(
    value,
    [
      "provider",
      "revision",
      "status",
      "address",
      "resourceId",
      "connectionId",
      "updatedAt",
      "issue",
      "approval",
    ],
    "Agent identity",
  );
  choice(value.provider, IDENTITY_PROVIDERS, "Identity provider");
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Identity revision", 1);
  choice(value.status, IDENTITY_STATUSES, "Identity status");
  integer(value.updatedAt, Number.MAX_SAFE_INTEGER, "Identity update time");
  if (value.approval !== null) {
    object(
      value.approval,
      ["kind", "at", "monthlyNumberCents"],
      "Identity approval",
    );
    choice(
      value.approval.kind,
      ["create", "existing"],
      "Identity approval kind",
    );
    integer(
      value.approval.at,
      Number.MAX_SAFE_INTEGER,
      "Identity approval time",
    );
    requireTask(
      value.approval.monthlyNumberCents ===
        (value.approval.kind === "create" && value.provider === "agentphone"
          ? 300
          : 0),
      "Identity approval cost changed.",
    );
  }
  for (const field of ["address", "resourceId", "connectionId", "issue"])
    if (value[field] !== null) text(value[field], 300, field);
  if (value.resourceId !== null) identityResource(value.resourceId);
  requireTask(
    value.status !== "ready" ||
      (value.address !== null &&
        value.resourceId !== null &&
        value.connectionId !== null),
    "Ready identity must have a saved connection.",
  );
  return structuredClone(value);
}

/** Human-only commands. Codes and keys never belong to ordinary task answers or model tools. */
export function parseIdentityCommand(kind, value) {
  const fields = ["provider", "expectedRevision"];
  const extras =
    kind === "start"
      ? ["humanEmail", "name", "consent", "monthlyNumberCents"]
      : kind === "verify"
        ? ["code"]
        : kind === "import"
          ? ["resourceId", "token", "consent"]
          : kind === "discover"
            ? ["token", "consent"]
            : [];
  choice(
    kind,
    ["start", "verify", "resend", "import", "discover", "disconnect", "check"],
    "Identity action",
  );
  object(value, [...fields, ...extras], "Private identity setup");
  choice(value.provider, IDENTITY_PROVIDERS, "Identity provider");
  integer(value.expectedRevision, Number.MAX_SAFE_INTEGER, "Identity revision");
  if (kind === "start") {
    identityEmail(value.humanEmail);
    text(value.name, 64, "Agent name");
    requireTask(
      /^[a-z][a-z0-9-]{2,63}$/.test(value.name),
      "Use a lowercase agent name with letters, numbers and hyphens.",
    );
    requireTask(
      value.monthlyNumberCents === (value.provider === "agentphone" ? 300 : 0),
      "Review the selected provider's number cost.",
    );
  }
  if (["start", "import", "discover"].includes(kind))
    requireTask(
      value.consent === true,
      "Approve this private provider connection.",
    );
  if (kind === "verify")
    requireTask(
      typeof value.code === "string" && /^\d{6}$/.test(value.code),
      "Use the six-digit verification code.",
    );
  if (kind === "import") {
    identityResource(value.resourceId);
    identityCredential(value.token);
  }
  if (kind === "discover") identityCredential(value.token);
  return structuredClone(value);
}
