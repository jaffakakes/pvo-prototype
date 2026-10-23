import {
  projectMarkers,
  shouldQueueProject,
  type ProjectMarkers,
} from "./projectMarkers";
import type { ProjectSnapshot } from "../../domain/project/model";
import { remapProjectMedia } from "../../domain/project/mediaReferences";
import { hasUnfinishedWork } from "../../domain/project/unfinishedWork";
import type { PersistenceSnapshot } from "./checkpoint";
import {
  captureCheckpoint,
  referencedMedia,
  restoreCheckpoint,
  storeCheckpoint,
  validateCheckpoint,
  type RestoredProject,
} from "./checkpoint";
import {
  advanceProjectDiscard,
  bindProjectDiscard,
  clearProjectDiscarded,
  completeProjectDiscard,
  getProjectDiscard,
} from "./discardMarker";
import {
  checkpointVersion,
  ProjectSaveConflict,
  type CheckpointVersion,
} from "./checkpointVersion";
import {
  discardProjectCheckpoint,
  listProjectMediaIds,
  openProjectDatabase,
  readProjectCheckpoint,
  readProjectMedia,
  writeProjectCheckpoint,
} from "./indexedDb";

export type { RestoredProject } from "./checkpoint";

export type ProjectPersistenceStatus = {
  phase: "idle" | "saving" | "saved" | "error";
  dirty: boolean;
  savedAt: number | null;
  error: string | null;
  conflict: boolean;
};

export type ProjectPersistence = {
  restore(): Promise<RestoredProject | null>;
  discardSavedProject(): Promise<void>;
  schedule(state: PersistenceSnapshot): void;
  flush(): Promise<void>;
  storedProject(project: ProjectSnapshot): ProjectSnapshot;
  dispose(): Promise<void>;
  getStatus(): ProjectPersistenceStatus;
  subscribeStatus(listener: () => void): () => void;
};

function contextualError(
  operation: "load" | "save" | "discard",
  error: unknown,
): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Could not ${operation} the Restyle project in browser storage: ${detail}`,
    { cause: error },
  );
}

function newAssetId(): string {
  if (crypto.randomUUID) return `asset:${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `asset:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createProjectPersistence(
  requestedId?: string,
): ProjectPersistence {
  let databasePromise: Promise<IDBDatabase> | null = null;
  let latestState: PersistenceSnapshot | null = null;
  let lastMarkers: ProjectMarkers | null = null;
  let revision = 0;
  let savedRevision = 0;
  let timer: number | undefined;
  let inFlight: Promise<void> | null = null;
  let closing = false;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let restorePromise: Promise<RestoredProject | null> | null = null;
  let knownAssetIds: Set<string> | null = null;
  const versions = new Map<string | null, CheckpointVersion>();
  let currentVersion: CheckpointVersion = null;
  let lastConflictProject: string | null | undefined;
  let status: ProjectPersistenceStatus = {
    phase: "idle",
    dirty: false,
    savedAt: null,
    error: null,
    conflict: false,
  };
  const listeners = new Set<() => void>();
  const mediaCache = new Map<string, Blob>();
  const assetIdByUrl = new Map<string, string>();

  const getDatabase = () =>
    (databasePromise ??= openProjectDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    }));
  const publish = (next: ProjectPersistenceStatus) => {
    status = next;
    listeners.forEach((listener) => listener());
  };
  const cancelTimer = () => {
    if (timer != null) clearTimeout(timer);
    timer = undefined;
  };

  async function blobFor(url: string): Promise<Blob> {
    const cached = mediaCache.get(url);
    if (cached) return cached;
    if (!url.startsWith("blob:"))
      throw new Error(
        `A clip uses an unsupported media URL: ${url.slice(0, 64)}`,
      );
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Could not read a video clip (${response.status}).`);
    const blob = await response.blob();
    mediaCache.set(url, blob);
    return blob;
  }

  async function saveUntilCurrent(): Promise<void> {
    while (savedRevision < revision) {
      const target = revision;
      const state = latestState;
      if (!state) return;
      publish({ ...status, phase: "saving", dirty: true, error: null });
      try {
        const reset = getProjectDiscard();
        const empty =
          !state.localId &&
          !hasUnfinishedWork({
            ...state,
            hasHistory: state.past.length > 0 || state.future.length > 0,
          });
        if (reset && empty) {
          if (!reset.completed) {
            if (reset.version === undefined) throw new ProjectSaveConflict();
            await discardProjectCheckpoint(
              await getDatabase(),
              reset.projectId,
              reset.version,
            );
            versions.set(reset.projectId, null);
            currentVersion = null;
            completeProjectDiscard(reset.token);
          }
          savedRevision = target;
          knownAssetIds = null;
          mediaCache.clear();
          assetIdByUrl.clear();
          publish({
            phase: "idle",
            dirty: target !== revision,
            savedAt: null,
            error: null,
            conflict: false,
          });
          continue;
        }
        const draft = captureCheckpoint(state);
        const urls = referencedMedia(draft);
        const database = await getDatabase();
        const expectedVersion = versions.get(state.localId) ?? null;
        knownAssetIds ??= await listProjectMediaIds(database);
        const newMedia = new Map<string, Blob>();
        await Promise.all(
          urls.map(async (url) => {
            let assetId = assetIdByUrl.get(url);
            if (!assetId) {
              assetId = newAssetId();
              assetIdByUrl.set(url, assetId);
            }
            // A fresh identity must carry its media even if another tab has
            // deleted the original since this tab last read the database.
            if (expectedVersion === null || !knownAssetIds!.has(assetId))
              newMedia.set(assetId, await blobFor(url));
          }),
        );
        // A new edit or reset during the asynchronous Blob read supersedes this draft.
        if (target !== revision) continue;
        const savedAt = Date.now();
        const record = storeCheckpoint(draft, assetIdByUrl, savedAt);
        if (target !== revision) continue;
        const previousSavedAt: unknown = expectedVersion
          ? JSON.parse(expectedVersion).savedAt
          : undefined;
        const unchanged =
          typeof previousSavedAt === "number" &&
          checkpointVersion({ ...record, savedAt: previousSavedAt }) ===
            expectedVersion;
        // Merely restoring an unchanged project must not create a competing
        // version just because the autosave controller scheduled it.
        if (unchanged) record.savedAt = previousSavedAt;
        else
          await writeProjectCheckpoint(database, record, newMedia, {
            expectedVersion,
            currentVersion,
          });
        const persistedVersion = checkpointVersion(record);
        versions.set(state.localId, persistedVersion);
        advanceProjectDiscard(state.localId, expectedVersion, persistedVersion);
        currentVersion = persistedVersion;
        savedRevision = target;
        knownAssetIds = await listProjectMediaIds(database);
        const wanted = new Set(urls);
        for (const cachedUrl of assetIdByUrl.keys())
          if (!wanted.has(cachedUrl)) assetIdByUrl.delete(cachedUrl);
        mediaCache.clear();
        if (target === revision && reset) clearProjectDiscarded(reset.token);
        publish({
          phase: "saved",
          dirty: target !== revision,
          savedAt: record.savedAt,
          error: null,
          conflict: false,
        });
      } catch (error) {
        if (target !== revision) continue;
        if (error instanceof ProjectSaveConflict)
          lastConflictProject = state.localId;
        const failure = contextualError("save", error);
        publish({
          ...status,
          phase: "error",
          dirty: true,
          error: failure.message,
          conflict: error instanceof ProjectSaveConflict,
        });
        throw failure;
      }
    }
  }

  async function drain(): Promise<void> {
    cancelTimer();
    while (savedRevision < revision) {
      if (!inFlight) inFlight = saveUntilCurrent();
      const active = inFlight;
      try {
        await active;
      } finally {
        // More than one caller may await the same save. An older waiter must
        // never clear a newer write that started in the meantime.
        if (inFlight === active) inFlight = null;
      }
    }
  }

  function schedule(state: PersistenceSnapshot): void {
    if (closing || disposed) return;
    latestState = state;
    const reset = getProjectDiscard();
    if (
      reset &&
      !reset.completed &&
      reset.version === undefined &&
      versions.has(reset.projectId)
    )
      bindProjectDiscard(reset.token, versions.get(reset.projectId)!);
    const next = projectMarkers(state);
    if (!shouldQueueProject(next, lastMarkers, state)) return;
    lastMarkers = next;
    revision += 1;
    publish({ ...status, dirty: true, error: null });
    cancelTimer();
    // Keep capturing local changes after a conflict, without repeatedly trying
    // to overwrite the same newer checkpoint. Retry or a copy is explicit.
    if (status.conflict && state.localId === lastConflictProject) return;
    timer = window.setTimeout(() => {
      void drain().catch(() => {});
    }, 800);
  }

  async function flush(): Promise<void> {
    if (disposed) throw new Error("Project storage has been closed.");
    if (latestState) {
      revision += 1;
      publish({ ...status, dirty: true, error: null });
    }
    await drain();
  }

  async function loadSavedProject(): Promise<RestoredProject | null> {
    if (disposed) throw new Error("Project storage has been closed.");
    try {
      const database = await getDatabase();
      const reset = getProjectDiscard();
      if (reset && (!requestedId || requestedId === reset.projectId)) {
        if (!reset.completed && reset.version !== undefined) {
          try {
            await discardProjectCheckpoint(
              database,
              reset.projectId,
              reset.version,
            );
            completeProjectDiscard(reset.token);
          } catch (error) {
            if (error instanceof ProjectSaveConflict)
              clearProjectDiscarded(reset.token);
            throw error;
          }
        }
        versions.set(reset.projectId, null);
        return null;
      }
      const record = await readProjectCheckpoint(database, requestedId);
      const version = checkpointVersion(record);
      versions.set(requestedId || null, version);
      currentVersion = version;
      if (record?.localId) versions.set(record.localId, version);
      if (!record) return null;
      validateCheckpoint(record);
      const media = await readProjectMedia(database, record.assetIds);
      knownAssetIds = await listProjectMediaIds(database);
      const urlMap = new Map<string, string>();
      try {
        for (const [assetId, blob] of media) {
          const url = URL.createObjectURL(blob);
          urlMap.set(assetId, url);
          assetIdByUrl.set(url, assetId);
        }
        const restored = restoreCheckpoint(record, urlMap);
        publish({
          phase: "saved",
          dirty: false,
          savedAt: record.savedAt,
          error: null,
          conflict: false,
        });
        return restored;
      } catch (error) {
        for (const url of urlMap.values()) {
          URL.revokeObjectURL(url);
          assetIdByUrl.delete(url);
        }
        throw error;
      }
    } catch (error) {
      const failure = contextualError("load", error);
      publish({
        ...status,
        phase: "error",
        error: failure.message,
        conflict: error instanceof ProjectSaveConflict,
      });
      throw failure;
    }
  }

  function restore(): Promise<RestoredProject | null> {
    return (restorePromise ??= loadSavedProject().catch((error) => {
      restorePromise = null;
      throw error;
    }));
  }

  async function discardSavedProject(): Promise<void> {
    if (disposed) throw new Error("Project storage has been closed.");
    try {
      const database = await getDatabase();
      const id = requestedId || null;
      if (!versions.has(id))
        throw new Error("Retry recovery before discarding the saved edit.");
      await discardProjectCheckpoint(database, id, versions.get(id)!);
      versions.set(id, null);
      currentVersion = null;
      restorePromise = Promise.resolve(null);
      knownAssetIds = null;
      mediaCache.clear();
      assetIdByUrl.clear();
      publish({
        phase: "idle",
        dirty: false,
        savedAt: null,
        error: null,
        conflict: false,
      });
    } catch (error) {
      const failure = contextualError("discard", error);
      publish({
        ...status,
        phase: "error",
        error: failure.message,
        conflict: error instanceof ProjectSaveConflict,
      });
      throw failure;
    }
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    closing = true;
    disposePromise = (async () => {
      try {
        if (restorePromise) await restorePromise.catch(() => null);
        await drain();
      } finally {
        disposed = true;
        cancelTimer();
        if (databasePromise) (await databasePromise.catch(() => null))?.close();
        listeners.clear();
      }
    })();
    return disposePromise;
  }

  const onHidden = () => {
    if (document.visibilityState === "hidden") void drain().catch(() => {});
  };
  const onPageHide = () => {
    void drain().catch(() => {});
  };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);

  return {
    restore,
    discardSavedProject,
    schedule,
    flush,
    storedProject: (project) => {
      if (disposed || status.dirty || status.phase === "error")
        throw new Error("Save this project before preparing a cloud task.");
      for (const scene of project.scenes)
        for (const clip of [...scene.clips, ...(scene.audioClips ?? [])]) {
          if (!clip.url) continue;
          const id = assetIdByUrl.get(clip.url);
          if (!id || !knownAssetIds?.has(id))
            throw new Error("This project's media has not been saved yet.");
        }
      return remapProjectMedia(project, assetIdByUrl);
    },
    dispose: async () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      await dispose();
    },
    getStatus: () => status,
    subscribeStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
