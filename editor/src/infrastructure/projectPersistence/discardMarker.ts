import type { CheckpointVersion } from "./checkpointVersion";

const KEY = "restyle-editor-project-reset";
export type ProjectDiscard = {
  token: string;
  projectId: string | null;
  completed: boolean;
  version?: CheckpointVersion;
};
let pending: ProjectDiscard | null = null;

function store(marker: ProjectDiscard | null): void {
  pending = marker;
  try {
    if (marker) sessionStorage.setItem(KEY, JSON.stringify(marker));
    else sessionStorage.removeItem(KEY);
  } catch {
    // The live tab retains its intent; unavailable storage cannot authorize
    // deleting another checkpoint after a reload.
  }
}

/** Tab-scoped reset intent also closes the reset/immediate-reload gap. */
export function markProjectDiscarded(projectId: string | null): void {
  store({ token: crypto.randomUUID(), projectId, completed: false });
}

export function getProjectDiscard(): ProjectDiscard | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return pending;
    const marker: unknown = JSON.parse(raw);
    if (
      marker &&
      typeof marker === "object" &&
      "token" in marker &&
      typeof marker.token === "string" &&
      "projectId" in marker &&
      (marker.projectId === null || typeof marker.projectId === "string") &&
      "completed" in marker &&
      typeof marker.completed === "boolean" &&
      (!("version" in marker) ||
        marker.version === null ||
        typeof marker.version === "string")
    )
      return marker as ProjectDiscard;
  } catch {
    // A corrupt/unavailable marker grants no additional deletion authority.
  }
  return pending;
}

export function bindProjectDiscard(
  token: string,
  version: CheckpointVersion,
): void {
  const marker = getProjectDiscard();
  if (
    marker?.token === token &&
    marker.version === undefined &&
    !marker.completed
  )
    store({ ...marker, version });
}

export function completeProjectDiscard(token: string): void {
  const marker = getProjectDiscard();
  if (marker?.token === token)
    store({ token, projectId: marker.projectId, completed: true });
}

/** A reset may arrive while this tab's previous write is committing. */
export function advanceProjectDiscard(
  projectId: string | null,
  previousVersion: CheckpointVersion,
  version: CheckpointVersion,
): void {
  const marker = getProjectDiscard();
  if (
    marker &&
    !marker.completed &&
    marker.projectId === projectId &&
    marker.version === previousVersion
  )
    store({ ...marker, version });
}

export function clearProjectDiscarded(token: string): void {
  if (getProjectDiscard()?.token === token) store(null);
}
