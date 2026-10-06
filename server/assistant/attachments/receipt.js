import {
  matchServiceAttachment,
  parseServiceAttachmentCommand,
  prepareServiceAttachmentReceipt,
} from "../../../packages/pvo-assistant/attachments/index.js";
import { sameServiceIdentity } from "../../../packages/pvo-assistant/releases/index.js";
import { prepareServicePublication } from "../../cloud-services/releaseContract.js";
import { withAssistantDeadline } from "../deadline.js";
import { hasCurrentClaim } from "../tasks/executionClaim.js";

/** Internal authoring boundary. All evidence is selected from the owner coordinator, not a caller-supplied report. */
export async function resolveTaskAttachment(coordinator, claimed, value) {
  const command = parseServiceAttachmentCommand(value);
  const current = () => {
    const task = coordinator.providers.task(claimed.id);
    if (
      !hasCurrentClaim(task, claimed, coordinator.now()) ||
      task.stepId !== "attach"
    )
      throw new Error("The attachment task is no longer current.");
    return task;
  };
  const task = current();
  const [row] = coordinator.providers.completed(
    task.id,
    command.connection.releaseId,
  );
  if (!row)
    throw new Error(
      "Attachment requires the task's completed service publication.",
    );
  const builder = coordinator.builders.get(task.id);
  const saved =
    builder && coordinator.artifacts.verified(task.id, builder.round);
  if (
    !saved ||
    builder.agreement?.digest !== saved.artifact.identity.agreementDigest ||
    builder.reviewFeedback?.report?.status !== "passed"
  )
    throw new Error(
      "Attachment requires the task's independently checked package.",
    );
  const publication = await prepareServicePublication(
    task,
    row.identity.operationId,
    { artifact: saved.artifact, report: saved.report },
    row.identity.expiresAt,
  );
  if (!sameServiceIdentity(publication.identity, row.identity))
    throw new Error(
      "The hosted release does not match the task's checked bytes.",
    );
  const provider = coordinator.serviceProvider();
  if (!provider) throw new Error("The service provider is unavailable.");
  current();
  const observation = await withAssistantDeadline(
    () => provider.lookup(row.identity),
    coordinator.providerTimeoutMs(),
  );
  current();
  const receipt = prepareServiceAttachmentReceipt(
    publication,
    observation,
    command.connection.operation,
    coordinator.now(),
  );
  return matchServiceAttachment(
    command,
    receipt,
    { ownerId: task.ownerId, projectId: task.input.projectId, taskId: task.id },
    coordinator.now(),
  );
}
