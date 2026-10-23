import {
  parseServiceConnections,
  parseServiceConnectionReport,
  SERVICE_CONNECTION_LIMITS,
  type ServiceConnectionReport,
} from "../../../../packages/pvo-assistant/hosting/index.js";
import { readAssistantJson } from "../assistant/serviceResponse";

async function request(
  ownerId: string,
  serviceId: string,
  kind: "connections" | "publication",
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
    throw new Error(
      response.status === 409
        ? "The connection list changed. Refresh and retry."
        : response.status === 429
          ? "This Container’s saved connection list is full."
          : "Couldn’t save or read the Container connection list. Check your account and retry.",
    );
  }
  const value = parseServiceConnections(
    await readAssistantJson(
      response,
      combined,
      SERVICE_CONNECTION_LIMITS.bytes,
    ),
  );
  if (
    value.service.identity.ownerId !== ownerId ||
    value.service.identity.serviceId !== serviceId
  )
    throw new Error("Container account changed.");
  return value;
}
export const readContainerConnections = (
  ownerId: string,
  serviceId: string,
  signal: AbortSignal,
) => request(ownerId, serviceId, "connections", signal);
export const sendContainerConnections = (
  ownerId: string,
  serviceId: string,
  report: ServiceConnectionReport,
  signal: AbortSignal,
) =>
  request(
    ownerId,
    serviceId,
    "connections",
    signal,
    parseServiceConnectionReport(report),
  );
export const sendContainerPublication = (
  ownerId: string,
  serviceId: string,
  exportId: string,
  publicationId: string,
  signal: AbortSignal,
) =>
  request(ownerId, serviceId, "publication", signal, {
    exportId,
    publicationId,
  });
