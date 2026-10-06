import { serializeWorkspaceRequest } from "../../../packages/pvo-assistant/workspaces/index.js";
import { prepareWorkspaceIdentity } from "../workspaces/identity.js";
import { contentDigest } from "../../contentDigest.js";
import { withAssistantDeadline } from "../deadline.js";
import { hasCurrentClaim } from "./executionClaim.js";

/** Journal one bounded tool call before dispatch; never replay an uncertain command. */
export async function runWorkspaceOperation(
  coordinator,
  claimed,
  kind,
  request,
) {
  return runJournaledWorkspaceOperation(
    coordinator,
    claimed,
    kind,
    request.id,
    await contentDigest(serializeWorkspaceRequest(kind, request)),
    (provider, identity, grant) =>
      provider.operate(identity, kind, request, grant),
  );
}

/** Shared claim/usage fencing for private workspace operations, including bounded source reads. */
export async function runJournaledWorkspaceOperation(
  coordinator,
  claimed,
  kind,
  operationId,
  inputDigest,
  invoke,
) {
  const provider = coordinator.workspaceProvider();
  if (!provider) throw new Error("Workspace provider is unavailable.");
  const identity = await prepareWorkspaceIdentity(claimed);
  let row = await coordinator.transaction(() =>
    coordinator.workspaces.begin(
      claimed,
      identity,
      kind,
      operationId,
      inputDigest,
      coordinator.now(),
    ),
  );
  if (!row || row.settled || row.dispatched) return row;
  const controller = new AbortController();
  coordinator.active.set(claimed.id, controller);
  try {
    const dispatched = await coordinator.transaction(() =>
      coordinator.workspaces.dispatch(claimed, row.id, coordinator.now()),
    );
    if (!dispatched) return coordinator.workspaces.get(row.id);
    try {
      const receipt = await withAssistantDeadline(
        () => {
          if (
            controller.signal.aborted ||
            !hasCurrentClaim(
              coordinator.workspaces.task(claimed.id),
              claimed,
              coordinator.now(),
            )
          )
            throw new Error("Workspace claim is no longer current.");
          return invoke(provider, identity, row.grant);
        },
        Math.max(
          1,
          Math.min(
            coordinator.workspaceTimeoutMs(),
            row.grant.expiresAt - coordinator.now(),
          ),
        ),
        controller.signal,
      );
      row = await coordinator.transaction(() =>
        coordinator.workspaces.observe(row.id, receipt, coordinator.now()),
      );
    } catch {
      await coordinator.transaction(() =>
        coordinator.workspaces.uncertain(claimed, row.id, coordinator.now()),
      );
    }
    return coordinator.workspaces.get(row.id);
  } finally {
    if (coordinator.active.get(claimed.id) === controller)
      coordinator.active.delete(claimed.id);
  }
}

/** Revoke the old claim before checking a missing receipt; a delayed RPC cannot arrive afterward and run. */
export async function reconcileTaskWorkspaces(coordinator) {
  const provider = coordinator.workspaceProvider();
  await coordinator.transaction(() =>
    coordinator.workspaces.noteTerminal(coordinator.now()),
  );
  for (const candidate of coordinator.workspaces
    .cleanupDue(coordinator.now())
    .slice(0, 2)) {
    try {
      if (!provider) throw new Error("Workspace provider unavailable.");
      const link = coordinator.workspaces.link(candidate.taskId);
      const observation = await withAssistantDeadline(
        () =>
          link.mode === "stop"
            ? provider.stop(link.identity)
            : provider.suspend(link.identity, link.grant.generation),
        coordinator.providerTimeoutMs(),
      );
      await coordinator.transaction(() =>
        coordinator.workspaces.observeCleanup(
          link,
          observation,
          coordinator.now(),
        ),
      );
    } catch {
      await coordinator.transaction(() =>
        coordinator.workspaces.cleanupFailed(candidate, coordinator.now()),
      );
    }
  }
  for (const row of coordinator.workspaces.due(coordinator.now()).slice(0, 4)) {
    try {
      if (!provider) throw new Error("Workspace provider unavailable.");
      const receipt = await withAssistantDeadline(
        () => provider.receipt(row.identity, row.operationId),
        coordinator.providerTimeoutMs(),
      );
      await coordinator.transaction(() =>
        coordinator.workspaces.observe(row.id, receipt, coordinator.now()),
      );
    } catch {
      await coordinator.transaction(() =>
        coordinator.workspaces.failedLookup(row.id, coordinator.now()),
      );
    }
  }
}
