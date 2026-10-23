import {
  object,
  text,
  id,
  list,
  choice,
  requireTask,
  unique,
} from "../tasks/validation.js";
import { parseConnectionPage } from "../connections/index.js";

export const CAPABILITY_RESEARCH_KINDS = [
  "connections_read",
  "capability_record",
];
export const CAPABILITY_STATUSES = [
  "available",
  "needs_account",
  "needs_adapter",
  "manual",
  "unverified",
];
const fields = [
  "key",
  "operation",
  "outcome",
  "selection",
  "status",
  "reason",
  "basis",
  "answerQuestionId",
];
const basisFields = [
  "type",
  "evidenceIds",
  "connectionReadId",
  "connectionId",
  "adapterOperation",
  "permissions",
];

export function parseCapabilityResearch(value) {
  if (value.kind === "connections_read") {
    object(value, ["kind", "after"], "Connection inspection");
    if (value.after !== null) id(value.after, "Connection cursor");
    return { kind: value.kind, after: value.after };
  }
  object(value, ["kind", ...fields], "Capability decision");
  requireTask(
    value.kind === "capability_record",
    "Expected a capability decision.",
  );
  id(value.key, "Capability key");
  for (const field of ["operation", "outcome", "reason"])
    text(value[field], 1000, field);
  choice(value.selection, ["proposed", "selected"], "Outcome selection");
  choice(value.status, CAPABILITY_STATUSES, "Capability status");
  if (value.answerQuestionId !== null)
    id(value.answerQuestionId, "Chosen answer");
  object(value.basis, basisFields, "Capability basis");
  choice(
    value.basis.type,
    ["component_logic", "container_state", "external"],
    "Capability basis type",
  );
  list(value.basis.evidenceIds, 4, "Documentation evidence");
  value.basis.evidenceIds.forEach((value) => id(value, "Evidence ID"));
  unique(value.basis.evidenceIds, "Documentation evidence");
  for (const field of ["connectionReadId", "connectionId", "adapterOperation"])
    if (value.basis[field] !== null) id(value.basis[field], field);
  list(value.basis.permissions, 32, "Required permissions");
  value.basis.permissions.forEach((permission) =>
    text(permission, 300, "Permission"),
  );
  unique(value.basis.permissions, "Required permissions");
  if (value.basis.type !== "external") {
    requireTask(
      value.basis.evidenceIds.length === 0 &&
        value.basis.permissions.length === 0 &&
        ["connectionReadId", "connectionId", "adapterOperation"].every(
          (field) => value.basis[field] === null,
        ),
      "Restyle capabilities do not require an external connection.",
    );
    requireTask(
      value.status === "available",
      "Existing Restyle capability is available for implementation.",
    );
  }
  const canonicalBasis = Object.fromEntries(
    basisFields.map((field) => [field, structuredClone(value.basis[field])]),
  );
  return {
    kind: value.kind,
    ...Object.fromEntries(
      fields.map((field) => [
        field,
        field === "basis" ? canonicalBasis : structuredClone(value[field]),
      ]),
    ),
  };
}

export function parseCapabilityResult(tool, value) {
  if (tool.kind === "connections_read") return parseConnectionPage(value);
  object(
    value,
    [
      "decision",
      "basisDigest",
      "connectionRevision",
      "answerCount",
      "verification",
    ],
    "Saved capability decision",
  );
  requireTask(
    JSON.stringify(parseCapabilityResearch(value.decision)) ===
      JSON.stringify(parseCapabilityResearch(tool)),
    "Saved capability differs from its request.",
  );
  requireTask(
    /^[a-f0-9]{64}$/.test(value.basisDigest),
    "Capability basis needs a digest.",
  );
  requireTask(
    value.connectionRevision === null ||
      (Number.isSafeInteger(value.connectionRevision) &&
        value.connectionRevision > 0),
    "Invalid connection revision.",
  );
  requireTask(
    Number.isSafeInteger(value.answerCount) && value.answerCount >= 0,
    "Invalid answer count.",
  );
  requireTask(
    value.verification === "planning_only",
    "Research cannot authorize or certify provider execution.",
  );
  return structuredClone(value);
}

const string = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const identifier = { ...string(128), pattern: "^[A-Za-z0-9_-]+$" };
const nullableId = { anyOf: [{ type: "null" }, identifier] };
const array = (items, maxItems) => ({ type: "array", items, maxItems });
const schema = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const capabilityDefinitions = [
  {
    kind: "connections_read",
    description:
      "Inspect this creator's account names, actual granted permissions and installed adapter operations, never credentials. Follow next with after until null; no accounts is an empty list, not a sign-in requirement.",
    schema: schema({ kind: { const: "connections_read" }, after: nullableId }),
  },
  {
    kind: "capability_record",
    description:
      "Save a request-specific capability and proposed/chosen outcome. Cite actual integration-document evidence and a connections_read receipt for external access. These are planning decisions, never execution permission. Reuse the same key for updates and cite a saved creator answer before selecting a manual alternative.",
    schema: schema({
      kind: { const: "capability_record" },
      key: identifier,
      operation: string(1000),
      outcome: string(1000),
      selection: { enum: ["proposed", "selected"] },
      status: { enum: CAPABILITY_STATUSES },
      reason: string(1000),
      basis: schema({
        type: { enum: ["component_logic", "container_state", "external"] },
        evidenceIds: array(identifier, 4),
        connectionReadId: nullableId,
        connectionId: nullableId,
        adapterOperation: nullableId,
        permissions: array(string(300), 32),
      }),
      answerQuestionId: nullableId,
    }),
  },
];
