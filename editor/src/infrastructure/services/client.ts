import {
  parseOwnedService,
  type OwnedService,
  SERVICE_CATALOG_LIMITS,
} from "../../../../packages/pvo-assistant/releases/index.js";
import {
  parseHostedSummary,
  parseServiceControl,
  type HostedServiceSummary,
  type ServiceControl,
} from "../../../../packages/pvo-assistant/hosting/index.js";
export type ManagedService = {
  metadata: OwnedService;
  summary: HostedServiceSummary | null;
};
export type PendingControl = { serviceId: string; control: ServiceControl };
export class ServiceRequestError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
  ) {
    super(message);
  }
}
async function request(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new ServiceRequestError(
      response.status === 401
        ? "Sign in again to manage your services."
        : response.status === 409
          ? "This service changed. Refresh its status before trying again."
          : response.status === 429
            ? "This service has reached its current limit."
            : "Couldn’t complete this request. Retry the same action.",
      response.status >= 400 && response.status < 500,
    );
  return response.json();
}
export async function listServices(
  ownerId: string,
  signal: AbortSignal,
): Promise<ManagedService[]> {
  const raw = (await request("/api/services", signal)) as {
    services?: unknown;
  };
  if (
    !Array.isArray(raw.services) ||
    raw.services.length > SERVICE_CATALOG_LIMITS.identities
  )
    throw new Error("Invalid service list.");
  return raw.services.map((item: ManagedService) => {
    const metadata = parseOwnedService(item.metadata),
      summary = item.summary === null ? null : parseHostedSummary(item.summary);
    if (
      metadata.identity.ownerId !== ownerId ||
      (summary &&
        Object.keys(metadata.identity).some(
          (key) =>
            metadata.identity[key as keyof OwnedService["identity"]] !==
            summary.service.identity[key as keyof OwnedService["identity"]],
        ))
    )
      throw new Error("Service account changed.");
    return { metadata, summary };
  });
}
export async function sendControl(
  pending: PendingControl,
  ownerId: string,
  signal: AbortSignal,
) {
  const body = (await request(
    `/api/services/${pending.serviceId}/${pending.control.kind}`,
    signal,
    pending.control,
  )) as { summary?: unknown };
  const summary = parseHostedSummary(body.summary);
  if (
    summary.service.identity.ownerId !== ownerId ||
    summary.service.identity.serviceId !== pending.serviceId
  )
    throw new Error("Service account changed.");
  return summary;
}
const key = (ownerId: string) => `restyle:pending-service-control:${ownerId}`;
export function readPendingControl(ownerId: string): PendingControl | null {
  const encoded = localStorage.getItem(key(ownerId));
  if (encoded === null) return null;
  const value = JSON.parse(encoded) as PendingControl;
  if (!/^service-[a-f0-9]{64}$/.test(value.serviceId))
    throw new Error("The saved service action could not be read.");
  return {
    serviceId: value.serviceId,
    control: parseServiceControl(value.control),
  };
}
export function savePendingControl(
  ownerId: string,
  value: PendingControl | null,
) {
  if (value) localStorage.setItem(key(ownerId), JSON.stringify(value));
  else localStorage.removeItem(key(ownerId));
}
