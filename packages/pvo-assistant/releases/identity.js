import { digest, id, integer, object } from "../tasks/validation.js";

const identifiers = [
  "resourceId",
  "serviceId",
  "ownerId",
  "projectId",
  "taskId",
  "operationId",
];
const digests = [
  "agreementDigest",
  "sourceDigest",
  "packageDigest",
  "reportDigest",
];
const fields = [...identifiers, ...digests, "expiresAt", "draftRevision"];

export function parseServiceIdentity(value) {
  object(value, fields, "Service release identity");
  for (const key of identifiers) id(value[key], "Service release ID");
  for (const key of digests) digest(value[key], key);
  integer(value.expiresAt, 8640000000000000, "Inactive service expiry", 1);
  if (value.draftRevision !== null)
    integer(
      value.draftRevision,
      Number.MAX_SAFE_INTEGER,
      "Checked draft revision",
    );
  return structuredClone(value);
}
export const serializeServiceIdentity = (value) => {
  const identity = parseServiceIdentity(value);
  return JSON.stringify(fields.map((key) => identity[key]));
};
export const sameServiceIdentity = (a, b) =>
  serializeServiceIdentity(a) === serializeServiceIdentity(b);
