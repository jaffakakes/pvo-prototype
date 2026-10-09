import {
  parsePublishedServiceOperations,
  parseServiceAttachmentReceipt,
  parseServiceAttachmentCommand,
  SERVICE_ATTACHMENT_BYTES,
  type ServiceAttachmentAuthorization,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import { readAssistantJson } from "../assistant/serviceResponse";
import { ServiceRequestError } from "./client";

async function request(
  serviceId: string,
  kind: "operations" | "attachment",
  signal: AbortSignal,
  body?: unknown,
) {
  if (!/^service-[a-f0-9]{64}$/.test(serviceId))
    throw new Error("Invalid Container identity.");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const response = await fetch(`/api/services/${serviceId}/${kind}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: combined,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ServiceRequestError(
      response.status === 409
        ? "The published version changed. Refresh its operations."
        : response.status === 404
          ? "Publish this Container and open its original project before connecting it."
          : "Couldn’t verify this connection. Check your account and try again.",
      response.status >= 400 && response.status < 500,
    );
  }
  return readAssistantJson(response, combined, SERVICE_ATTACHMENT_BYTES);
}
export async function readContainerOperations(
  ownerId: string,
  serviceId: string,
  signal: AbortSignal,
) {
  const value = parsePublishedServiceOperations(
    await request(serviceId, "operations", signal),
  );
  if (
    value.service.identity.ownerId !== ownerId ||
    value.service.identity.serviceId !== serviceId
  )
    throw new Error("Container account changed.");
  return value;
}
export async function verifyContainerAttachment(
  authorization: ServiceAttachmentAuthorization,
  signal: AbortSignal,
) {
  const expected = authorization.receipt.identity;
  const raw = (await request(expected.serviceId, "attachment", signal, {
    projectId: authorization.scope.projectId,
    command: authorization.command,
  })) as { command?: unknown; receipt?: unknown };
  const command = parseServiceAttachmentCommand(raw.command),
    receipt = parseServiceAttachmentReceipt(raw.receipt);
  if (
    JSON.stringify(command) !== JSON.stringify(authorization.command) ||
    ["ownerId", "projectId", "serviceId", "resourceId"].some(
      (key) =>
        receipt.identity[key as keyof typeof expected] !==
        expected[key as keyof typeof expected],
    )
  )
    throw new Error(
      "The verified Container connection changed. Refresh before trying again.",
    );
  return {
    ...authorization,
    command,
    receipt,
    now: receipt.readiness.observedAt,
  };
}
