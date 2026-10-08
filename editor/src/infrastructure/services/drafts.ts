import {
  parseServiceDraft,
  parseServiceDraftSave,
  type ServiceDraft,
  type ServiceDraftContent,
  type ServiceDraftSave,
} from "../../../../packages/pvo-assistant/services/index.js";
import { ServiceRequestError } from "./client";

const path = (serviceId: string) => {
  if (!/^service-[a-f0-9]{64}$/.test(serviceId))
    throw new Error("Invalid Container identity.");
  return `/api/services/${serviceId}/draft`;
};
async function request(
  url: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new ServiceRequestError(
      response.status === 409
        ? "A newer draft is saved. Review it before reapplying your edits."
        : response.status === 401
          ? "Sign in again to recover your draft."
          : response.status === 429
            ? "Your Container storage limit has been reached."
            : response.status === 404
              ? "This Container or project is unavailable."
              : response.status === 400
                ? "Check the draft fields and file sizes before saving again."
                : "The save could not be confirmed. Retry the saved action.",
      response.status >= 400 && response.status < 500,
    );
  return response.json();
}
function owned(value: unknown, ownerId: string, serviceId?: string) {
  const draft = parseServiceDraft(value);
  if (
    draft.identity.ownerId !== ownerId ||
    (serviceId && draft.identity.serviceId !== serviceId)
  )
    throw new Error("Container account changed.");
  return draft;
}
export async function readDraft(
  serviceId: string,
  ownerId: string,
  signal: AbortSignal,
) {
  return owned(await request(path(serviceId), signal), ownerId, serviceId);
}
export async function saveDraft(
  serviceId: string,
  ownerId: string,
  command: ServiceDraftSave,
  signal: AbortSignal,
) {
  const value = (await request(
    path(serviceId),
    signal,
    parseServiceDraftSave(command),
  )) as { draft?: unknown; receipt?: { actionId?: string; revision?: number } };
  const draft = owned(value.draft, ownerId, serviceId);
  if (
    value.receipt?.actionId !== command.actionId ||
    value.receipt?.revision !== command.expectedRevision + 1
  )
    throw new Error("The saved draft receipt could not be confirmed.");
  return draft;
}
export type DraftCreation = {
  actionId: string;
  projectId: string;
  description: string;
};
export async function createContainer(
  ownerId: string,
  command: DraftCreation,
  signal: AbortSignal,
) {
  const value = (await request("/api/services", signal, command)) as {
    draft?: unknown;
  };
  const draft = owned(value.draft, ownerId);
  if (draft.identity.projectId !== command.projectId)
    throw new Error("Container project changed.");
  return draft;
}
export type DraftBuffer = {
  base: ServiceDraft;
  content: ServiceDraftContent;
  agreementText: string;
  pending: ServiceDraftSave | null;
};
const key = (ownerId: string, serviceId: string) =>
  `restyle:container-draft:${ownerId}:${serviceId}`;
export function readDraftBuffer(
  ownerId: string,
  serviceId: string,
): DraftBuffer | null {
  const raw = localStorage.getItem(key(ownerId, serviceId));
  if (!raw) return null;
  const buffer = JSON.parse(raw) as DraftBuffer;
  owned(buffer.base, ownerId, serviceId);
  if (
    typeof buffer.agreementText !== "string" ||
    !Array.isArray(buffer.content?.files)
  )
    throw new Error("The local draft could not be recovered.");
  if (buffer.pending) parseServiceDraftSave(buffer.pending);
  return buffer;
}
export function saveDraftBuffer(
  ownerId: string,
  serviceId: string,
  buffer: DraftBuffer | null,
) {
  if (buffer)
    localStorage.setItem(key(ownerId, serviceId), JSON.stringify(buffer));
  else localStorage.removeItem(key(ownerId, serviceId));
}
const creationKey = (ownerId: string) => `restyle:container-create:${ownerId}`;
export function pendingContainerCreation(
  ownerId: string,
): DraftCreation | null {
  const raw = localStorage.getItem(creationKey(ownerId));
  return raw ? (JSON.parse(raw) as DraftCreation) : null;
}
export function saveContainerCreation(
  ownerId: string,
  value: DraftCreation | null,
) {
  if (value) localStorage.setItem(creationKey(ownerId), JSON.stringify(value));
  else localStorage.removeItem(creationKey(ownerId));
}
