import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import {
  parseServiceAttachmentCommand,
  prepareServiceAttachmentReceipt,
  parsePublishedServiceOperations,
  matchServiceAttachment,
} from "../../packages/pvo-assistant/attachments/index.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";
import { object, id } from "../../packages/pvo-assistant/tasks/validation.js";
import { ownedHost } from "./ownership.js";

function published(host, serviceId, ownerId) {
  const service = ownedHost(host, serviceId, ownerId);
  if (service.state !== "active")
    throw serviceCallError(
      "unavailable",
      "Publish or resume this Container before connecting it.",
    );
  const row = host.store.row(service.liveReleaseId);
  if (!row?.body || !row.retained)
    throw serviceCallError(
      "unavailable",
      "This published version is unavailable.",
    );
  const publication = parseServicePublication(JSON.parse(row.body));
  return {
    service,
    publication,
    observation: host.store.observation(publication.identity, row),
  };
}

export function publishedServiceOperations(host, serviceId, ownerId) {
  const { service, publication, observation } = published(
    host,
    serviceId,
    ownerId,
  );
  return parsePublishedServiceOperations({
    service,
    operations: publication.artifact.agreement.operations
      .filter((operation) => operation.audience === "public")
      .map((operation) =>
        prepareServiceAttachmentReceipt(
          publication,
          observation,
          operation.name,
          host.now(),
        ),
      ),
  });
}

/** Reuse the checked attachment command. This reads readiness, never changes live code or records. */
export function resolvePublishedAttachment(host, serviceId, ownerId, value) {
  let command;
  try {
    object(value, ["projectId", "command"], "Container attachment request");
    id(value.projectId, "Attachment project");
    command = parseServiceAttachmentCommand(value.command);
  } catch {
    throw serviceCallError(
      "invalid_input",
      "The component connection is invalid.",
    );
  }
  const { service, publication, observation } = published(
    host,
    serviceId,
    ownerId,
  );
  if (service.identity.projectId !== value.projectId)
    throw serviceCallError(
      "unavailable",
      "Open this Container’s project before connecting a component.",
    );
  if (command.connection.releaseId !== service.liveReleaseId)
    throw serviceCallError(
      "state_changed",
      "The published version changed. Refresh its operations.",
    );
  const operation = publication.artifact.agreement.operations.find(
    (item) => item.name === command.connection.operation,
  );
  if (!operation || operation.audience !== "public")
    throw serviceCallError(
      "forbidden",
      "This operation cannot be connected to a component.",
    );
  try {
    const receipt = prepareServiceAttachmentReceipt(
      publication,
      observation,
      operation.name,
      host.now(),
    );
    return matchServiceAttachment(
      command,
      receipt,
      {
        ownerId,
        projectId: value.projectId,
        taskId: publication.identity.taskId,
      },
      host.now(),
    );
  } catch {
    throw serviceCallError(
      "invalid_input",
      "The field mapping does not match this operation.",
    );
  }
}
