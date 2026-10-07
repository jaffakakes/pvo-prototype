import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import {
  parseServiceRecords,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";
import { ownedHost } from "./control.js";

/** One transaction reads the authoritative host; this never invokes generated code. */
export function inspectServiceRecords(host, serviceId, ownerId) {
  const service = ownedHost(host, serviceId, ownerId);
  if (service.state === "deleted")
    throw serviceCallError("unavailable", "This Container has been deleted.");
  const observedAt = host.now();
  host.store.expire(observedAt);
  host.cleanupDeletedReleases();
  const areas = [];
  for (const row of host.store.rows()) {
    if (!row.body) continue;
    const publication = parseServicePublication(JSON.parse(row.body));
    const releaseId = publication.identity.resourceId;
    const initial = publication.artifact.agreement.state.initial;
    if (releaseId === service.liveReleaseId)
      areas.unshift({
        mode: "live",
        releaseId,
        ...host.actions.records("live", initial, observedAt),
      });
    areas.push({
      mode: "test",
      releaseId,
      ...host.actions.records(`test:${releaseId}`, initial, observedAt),
    });
  }
  return parseServiceRecords({
    service: host.store.service(),
    observedAt,
    areas,
  });
}
