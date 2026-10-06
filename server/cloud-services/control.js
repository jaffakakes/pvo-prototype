import {
  parseServiceControl,
  serializeServiceControl,
  planServiceControl,
  serviceCallError,
  parseHostedSummary,
} from "../../packages/pvo-assistant/hosting/index.js";
import { contentDigest } from "../contentDigest.js";

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
export function inspectHostedService(host, serviceId, ownerId) {
  ownedHost(host, serviceId, ownerId);
  host.store.expire(host.now());
  host.cleanupDeletedReleases();
  const service = host.store.service();
  const releases = host.store
    .rows()
    .map((row) => host.store.observation(JSON.parse(row.identity), row));
  return parseHostedSummary({ service, releases });
}
export async function controlHostedService(host, serviceId, ownerId, value) {
  ownedHost(host, serviceId, ownerId);
  let control;
  try {
    control = parseServiceControl(value);
  } catch {
    throw serviceCallError("invalid_input", "The service control is invalid.");
  }
  const digest = await contentDigest(serializeServiceControl(control));
  return host.ctx.storage.transaction(async () => {
    const service = ownedHost(host, serviceId, ownerId);
    const prior = host.controls.receipt(control.actionId, digest);
    if (prior)
      return {
        receipt: prior,
        summary: inspectHostedService(host, serviceId, ownerId),
      };
    const next = planServiceControl(service, control, host.now());
    if (control.kind === "activate") {
      const row = host.store.row(control.releaseId);
      if (
        !row ||
        !host.store.current(JSON.parse(row.identity), host.now())?.body
      )
        throw serviceCallError(
          "unavailable",
          "This checked release is unavailable.",
        );
      host.store.retain(control.releaseId);
    }
    host.store.saveService(next);
    if (control.kind === "delete") {
      host.store.deleteReleases();
      host.actions.clearAll();
    }
    if (host.calls.active) host.calls.cancel(host.calls.active.resourceId);
    const receipt = {
      actionId: control.actionId,
      kind: control.kind,
      revision: next.revision,
      at: host.now(),
    };
    host.controls.save(digest, receipt);
    await host.scheduleExpiry();
    return { receipt, summary: inspectHostedService(host, serviceId, ownerId) };
  });
}
