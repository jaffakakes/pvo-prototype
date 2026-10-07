import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import {
  parseServiceControl,
  serializeServiceControl,
  planServiceControl,
  serviceCallError,
  parseHostedSummary,
  prepareReleaseActivation,
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
  return parseHostedSummary({
    service,
    releases,
    draftRevision: host.drafts.read()?.revision ?? null,
  });
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
      const publication = parseServicePublication(JSON.parse(row.body));
      if (
        !row.retained &&
        publication.identity.draftRevision !== null &&
        host.drafts.read()?.revision !== publication.identity.draftRevision
      )
        throw serviceCallError(
          "state_changed",
          "The draft has changed since this version was checked. Test the saved draft again before publishing.",
        );
      const candidate = publication.artifact.agreement;
      const previousRow = service.liveReleaseId
        ? host.store.row(service.liveReleaseId)
        : null;
      if (service.liveReleaseId && !previousRow?.body)
        throw serviceCallError(
          "unavailable",
          "The current service version is unavailable.",
        );
      const previous = previousRow
        ? parseServicePublication(JSON.parse(previousRow.body)).artifact
            .agreement
        : null;
      const snapshot = host.actions.data(
        "live",
        previous ? previous.state.initial : candidate.state.initial,
      );
      const state = prepareReleaseActivation(
        previous,
        candidate,
        snapshot.state,
      );
      host.actions.initializeLive(state);
      host.store.retain(control.releaseId);
    }
    host.store.saveService(next);
    if (control.kind === "delete") {
      host.store.deleteReleases();
      host.actions.clearAll();
      host.drafts.clear();
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
