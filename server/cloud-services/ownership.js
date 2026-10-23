import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";

export function ownedHost(host, serviceId, ownerId) {
  const service = host.store.service();
  if (
    !service ||
    service.identity.serviceId !== serviceId ||
    service.identity.ownerId !== ownerId
  )
    throw serviceCallError("unavailable", "This service is unavailable.");
  return service;
}
