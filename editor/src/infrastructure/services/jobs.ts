import { parseCreatorJobs } from "../../../../packages/pvo-assistant/jobs/index.js";

/** Private creator commands share the server's account boundary; no viewer key leaves local storage. */
export async function readContainerJobs(
  serviceId: string,
  ownerId: string,
  signal: AbortSignal,
) {
  const response = await fetch(`/api/services/${serviceId}/jobs`, {
    credentials: "same-origin",
    headers: { "X-Restyle-Owner": ownerId },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok)
    throw new Error("Couldn’t load background work. Refresh to try again.");
  return parseCreatorJobs(await response.json(), ownerId, serviceId);
}
export async function controlContainerJob(
  serviceId: string,
  ownerId: string,
  actionId: string,
  kind: "cancel" | "resume",
  signal: AbortSignal,
) {
  const response = await fetch(`/api/services/${serviceId}/job-control`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Restyle-Owner": ownerId },
    body: JSON.stringify({ actionId, kind }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "This action may already have started. Refresh and inspect its saved outcome."
        : "Couldn’t check this saved action. Refresh before trying again.",
    );
}
