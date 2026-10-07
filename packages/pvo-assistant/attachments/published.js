import {
  object,
  list,
  boundedJson,
  unique,
  requireTask,
} from "../tasks/validation.js";
import { parseHostedService } from "../hosting/index.js";
import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { parseServiceAttachmentReceipt } from "./receipt.js";

export const SERVICE_ATTACHMENT_BYTES = 512 * 1024;
/** Owner-only operation descriptions from the current host; no source, state or private operations. */
export function parsePublishedServiceOperations(value) {
  object(value, ["service", "operations"], "Published Container operations");
  const service = parseHostedService(value.service);
  requireTask(
    service.state === "active",
    "Publish or resume this Container before connecting it.",
  );
  list(
    value.operations,
    SERVICE_PACKAGE_LIMITS.operations,
    "Published operations",
  );
  const operations = value.operations.map((item) => {
    const receipt = parseServiceAttachmentReceipt(item);
    requireTask(
      receipt.readiness.state === "retained" &&
        receipt.identity.resourceId === service.liveReleaseId &&
        ["ownerId", "projectId", "serviceId"].every(
          (key) => receipt.identity[key] === service.identity[key],
        ),
      "Published operation ownership or release conflicts.",
    );
    return receipt;
  });
  unique(
    operations.map((item) => item.operation.name),
    "Published operations",
  );
  boundedJson(value, SERVICE_ATTACHMENT_BYTES, "Published operations");
  return { service, operations };
}
