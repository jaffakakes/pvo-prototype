import {
  prepareServicePublication,
  serviceIntentDigest,
} from "../../cloud-services/releaseContract.js";
import { parseServiceObservation } from "../../../packages/pvo-assistant/releases/index.js";
import { withAssistantDeadline } from "../deadline.js";
import { hasCurrentClaim } from "./executionClaim.js";

const callMs = (coordinator) => coordinator.providerTimeoutMs();

/** Persist intent/dispatch before the provider effect. Uncertain writes are never retried here. */
export async function publishTaskService(coordinator, claimed, source) {
  const provider = coordinator.serviceProvider();
  if (!provider) throw new Error("Service publication is unavailable.");
  const publication = await prepareServicePublication(
    claimed,
    `service-${claimed.retries}`,
    source,
  );
  const inputDigest = await serviceIntentDigest(publication.identity);
  let row = await coordinator.transaction(() =>
    coordinator.providers.begin(
      claimed,
      publication,
      inputDigest,
      coordinator.now(),
    ),
  );
  if (!row || row.settled || row.dispatched) return row;
  const controller = new AbortController();
  try {
    const dispatched = await coordinator.transaction(() =>
      coordinator.providers.dispatch(claimed, row.id, coordinator.now()),
    );
    if (!dispatched) return coordinator.providers.get(row.id);
    coordinator.active.set(claimed.id, controller);
    try {
      const observation = await withAssistantDeadline(
        () => {
          if (
            controller.signal.aborted ||
            !hasCurrentClaim(
              coordinator.providers.task(claimed.id),
              claimed,
              coordinator.now(),
            )
          )
            throw new Error("Publication claim is no longer current.");
          return provider.publish(publication);
        },
        callMs(coordinator),
        controller.signal,
      );
      row = await coordinator.transaction(() =>
        coordinator.providers.observe(
          row.id,
          parseServiceObservation(observation, row.identity),
          coordinator.now(),
        ),
      );
    } catch {
      await coordinator.transaction(() =>
        coordinator.providers.uncertain(claimed, row.id, coordinator.now()),
      );
    }
    return coordinator.providers.get(row.id);
  } finally {
    if (coordinator.active.get(claimed.id) === controller)
      coordinator.active.delete(claimed.id);
  }
}

/** Bounded maintenance can adopt an existing release or cancel its identity, never create one. */
export async function reconcileTaskServices(coordinator) {
  const provider = coordinator.serviceProvider();
  if (!provider) {
    await coordinator.transaction(() => {
      for (const row of coordinator.providers
        .due(coordinator.now())
        .slice(0, 2))
        coordinator.providers.failedLookup(row.id, coordinator.now());
    });
    return;
  }
  for (const candidate of coordinator.providers
    .due(coordinator.now())
    .slice(0, 2)) {
    try {
      let row = coordinator.providers.get(candidate.id);
      const observation = await withAssistantDeadline(
        () => provider.lookup(row.identity),
        callMs(coordinator),
      );
      row = await coordinator.transaction(() =>
        coordinator.providers.observe(
          row.id,
          parseServiceObservation(observation, row.identity),
          coordinator.now(),
        ),
      );
      // Stop may have arrived during the lookup. Read the committed cancellation state again.
      row = coordinator.providers.get(candidate.id);
      if (row.cancelRequested && !row.cancelled) {
        const cancelled = await withAssistantDeadline(
          () => provider.cancel(row.identity),
          callMs(coordinator),
        );
        await coordinator.transaction(() =>
          coordinator.providers.observe(
            row.id,
            parseServiceObservation(cancelled, row.identity),
            coordinator.now(),
          ),
        );
      }
    } catch {
      await coordinator.transaction(() =>
        coordinator.providers.failedLookup(candidate.id, coordinator.now()),
      );
    }
  }
}
