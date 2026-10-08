import {
  parseServiceAccountAccess,
  type ServiceAccountAccess,
} from "../../../../packages/pvo-assistant/hosting/index.js";
import { SERVICE_EXECUTION_LIMITS } from "../../../../packages/pvo-assistant/services/index.js";
import { readAssistantJson } from "../assistant/serviceResponse";

async function accountRequest(
  serviceId: string,
  operation: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<unknown> {
  if (!/^service-[a-f0-9]{64}$/.test(serviceId))
    throw new Error("Invalid Container.");
  const current = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const response = await fetch(`/api/services/${serviceId}/${operation}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: current,
  });
  const value = await readAssistantJson(response, current, 64 * 1024);
  if (!response.ok) {
    const message =
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string" &&
      value.error.length <= 1024
        ? value.error
        : "Account access could not be checked. Refresh and retry.";
    throw new Error(message);
  }
  return value;
}
export async function containerAccountAccess(
  ownerId: string,
  serviceId: string,
  releaseId: string,
  kind: "inspect" | "approve" | "revoke",
  signal: AbortSignal,
): Promise<ServiceAccountAccess> {
  const result = parseServiceAccountAccess(
    await accountRequest(
      serviceId,
      "account-access",
      { kind, releaseId },
      signal,
    ),
  );
  if (
    result.ownerId !== ownerId ||
    result.serviceId !== serviceId ||
    result.releaseId !== releaseId
  )
    throw new Error(
      "The account or Container version changed. Refresh to continue.",
    );
  return result;
}
export async function resumeContainerAccountAction(
  serviceId: string,
  actionId: string,
  signal: AbortSignal,
): Promise<void> {
  await accountRequest(
    serviceId,
    "resume-account-action",
    { actionId },
    signal,
    SERVICE_EXECUTION_LIMITS.requestMs,
  );
}
