import { parseTaskRecord } from "../../packages/pvo-assistant/tasks/index.js";
import {
  parseServicePublication,
  parseServiceSource,
  serializeServiceIdentity,
} from "../../packages/pvo-assistant/releases/index.js";

export async function serviceDigest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export const serviceIntentDigest = (identity) =>
  serviceDigest(serializeServiceIdentity(identity));
export const serviceResourceId = (identity) =>
  serviceDigest(
    JSON.stringify([
      identity.ownerId,
      identity.projectId,
      identity.taskId,
      identity.operationId,
    ]),
  ).then((hash) => `release-${hash}`);

/** Only trusted task code selects the operation; generated code never supplies ownership. */
export async function prepareServicePublication(value, operationId, source) {
  const task = parseTaskRecord(value);
  source = parseServiceSource(source);
  const identity = {
    ownerId: task.ownerId,
    projectId: task.input.projectId,
    taskId: task.id,
    operationId,
    sourceDigest: await serviceDigest(source),
    expiresAt: task.deadlineAt,
  };
  return parseServicePublication({
    identity: { resourceId: await serviceResourceId(identity), ...identity },
    source,
  });
}

export async function verifyServicePublication(value) {
  const publication = parseServicePublication(value);
  if (
    (await serviceResourceId(publication.identity)) !==
    publication.identity.resourceId
  )
    throw new Error("Service identity does not match its owner and task.");
  if (
    (await serviceDigest(publication.source)) !==
    publication.identity.sourceDigest
  )
    throw new Error("Service source does not match its saved digest.");
  return publication;
}
