import { parseNativeOperation } from "../native/index.js";
import { parseTaskReference } from "../tasks/index.js";
import { choice, id, object, requireTask, time } from "../tasks/validation.js";
import { serviceName } from "../services/values.js";
import { validateAttachmentInput } from "./input.js";
import { parseServiceAttachmentReceipt } from "./receipt.js";

/** Connection fields cannot supply URL, readiness, credential or receipt authority; source is checked separately. */
export function parseServiceAttachmentCommand(value) {
  object(
    value,
    ["kind", "component", "connection"],
    "Service attachment command",
  );
  requireTask(
    value.kind === "service.attach",
    "Unsupported service attachment command.",
  );
  const component = parseNativeOperation(value.component);
  requireTask(
    ["component.add", "component.source"].includes(component.kind) &&
      component.source,
    "A service attachment needs one complete component source proposal.",
  );
  const connection = value.connection;
  object(
    connection,
    ["releaseId", "operation", "event", "target", "input"],
    "Service connection",
  );
  id(connection.releaseId, "Attached release ID");
  serviceName(connection.operation, "Attached operation name");
  choice(
    connection.event,
    ["press", "choose", "submit"],
    "Service connection event",
  );
  if (connection.event === "submit")
    requireTask(
      connection.target === null,
      "Submit connections have no target.",
    );
  else id(connection.target, "Service connection target");
  validateAttachmentInput(connection.input);
  return structuredClone(value);
}

/** Scope comes from the authenticated task/current project, never from the proposed command. */
export function matchServiceAttachment(value, receiptValue, scopeValue, now) {
  const command = parseServiceAttachmentCommand(value);
  const receipt = parseServiceAttachmentReceipt(receiptValue);
  const scope = parseTaskReference(scopeValue);
  time(now, "Attachment time");
  for (const key of ["ownerId", "projectId", "taskId"])
    requireTask(
      receipt.identity[key] === scope[key],
      "Service receipt belongs to a different account, project or task.",
    );
  requireTask(
    command.connection.releaseId === receipt.identity.resourceId &&
      command.connection.operation === receipt.operation.name,
    "Service attachment does not match its verified release and operation.",
  );
  requireTask(
    receipt.readiness.observedAt <= now &&
      (receipt.readiness.state === "retained" ||
        now < receipt.identity.expiresAt),
    "Service readiness must be checked again before attachment.",
  );
  validateAttachmentInput(command.connection.input, receipt.operation.input);
  return { command, receipt };
}
