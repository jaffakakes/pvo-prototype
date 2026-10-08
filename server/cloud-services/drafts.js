import {
  parseServiceDraftSave,
  serializeServiceDraftSave,
  newServiceDraftContent,
} from "../../packages/pvo-assistant/services/index.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";
import {
  object,
  id,
  text,
} from "../../packages/pvo-assistant/tasks/validation.js";
import { ownedHost } from "./ownership.js";
import { contentDigest } from "../contentDigest.js";

export function readHostedDraft(host, serviceId, ownerId) {
  const service = ownedHost(host, serviceId, ownerId);
  if (service.state === "deleted")
    throw serviceCallError("unavailable", "This Container has been deleted.");
  const draft = host.drafts.read();
  if (!draft)
    throw serviceCallError(
      "unavailable",
      "This Container draft is unavailable.",
    );
  return draft;
}
export async function saveHostedDraft(
  host,
  serviceId,
  ownerId,
  value,
  grant = null,
) {
  readHostedDraft(host, serviceId, ownerId);
  let command;
  try {
    command = parseServiceDraftSave(value);
  } catch {
    throw serviceCallError(
      "invalid_input",
      "The draft is invalid or exceeds its size limit.",
    );
  }
  const digest = await contentDigest(serializeServiceDraftSave(command));
  return host.ctx.storage.transaction(async () => {
    readHostedDraft(host, serviceId, ownerId);
    if (grant) host.draftWriters.admit(grant, host.now());
    const result = host.drafts.save(command, digest, host.now());
    await host.scheduleExpiry();
    return result;
  });
}
export function parseDraftCreation(value) {
  try {
    object(value, ["actionId", "projectId", "description"], "Create Container");
    id(value.actionId, "Creation action");
    id(value.projectId, "Project");
    text(value.description, 2048, "Container description");
    return structuredClone(value);
  } catch {
    throw serviceCallError(
      "invalid_input",
      "A project, name and creation action are required.",
    );
  }
}
export function initializeHostedDraft(host, identity, description) {
  return host.ctx.storage.transactionSync(() => {
    const service = host.store.bind(identity, host.now());
    if (service.state === "deleted")
      throw serviceCallError("unavailable", "This Container has been deleted.");
    return host.drafts.initialize(
      service.identity,
      newServiceDraftContent(description),
      host.now(),
    );
  });
}
