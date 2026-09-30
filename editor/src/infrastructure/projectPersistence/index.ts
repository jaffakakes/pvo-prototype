import type { PersistenceSnapshot } from "./checkpoint";
import {
  captureCheckpoint,
  referencedMedia,
  restoreCheckpoint,
  storeCheckpoint,
  validateCheckpoint,
  type RestoredProject,
} from "./checkpoint";
import { clearProjectDiscarded, isProjectDiscarded } from "./discardMarker";
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
};

export type ProjectPersistence = {
  restore(): Promise<RestoredProject | null>;
  discardSavedProject(): Promise<void>;
  schedule(state: PersistenceSnapshot): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): ProjectPersistenceStatus;
  subscribeStatus(listener: () => void): () => void;
};

type ProjectMarkers = Pick<
  PersistenceSnapshot,
  | "scenes"
  | "past"
  | "future"
  | "ratio"
  | "allowedDomains"
  | "currentSceneId"
  | "screen"
  | "sel"
  | "selComp"
  | "selText"
  | "exportFormat"
  | "quality"
  | "localId"
  | "projectName"
> & { t: number };

function markers(state: PersistenceSnapshot): ProjectMarkers {
  return {
    localId: state.localId,
    projectName: state.projectName,
    scenes: state.scenes,
    past: state.past,
    future: state.future,
    ratio: state.ratio,
    allowedDomains: state.allowedDomains,
    currentSceneId: state.currentSceneId,
    screen: state.screen,
    sel: state.sel,
    selComp: state.selComp,
    selText: state.selText,
    exportFormat: state.exportFormat,
    quality: state.quality,
    t: state.t,
  };
}

function shouldQueue(
  current: ProjectMarkers,
  previous: ProjectMarkers | null,
  state: PersistenceSnapshot,
): boolean {
  if (!previous) return true;
  if (
    current.localId !== previous.localId ||
    current.projectName !== previous.projectName
  )
    return true;
  if (
    current.scenes !== previous.scenes ||
    current.past !== previous.past ||
    current.future !== previous.future ||
    current.ratio !== previous.ratio ||
    current.allowedDomains !== previous.allowedDomains ||
    current.currentSceneId !== previous.currentSceneId ||
    current.screen !== previous.screen ||
    current.sel !== previous.sel ||
    current.selComp !== previous.selComp ||
    current.selText !== previous.selText ||
    current.exportFormat !== previous.exportFormat ||
    current.quality !== previous.quality
  )
    return true;
  // Playback can patch time every frame. Every paused scrub is saved after debounce.
  return !state.playing && current.t !== previous.t;
}

function contextualError(operation: "load" | "save" | "discard", error: unknown): Error {
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
  let status: ProjectPersistenceStatus = {
    phase: "idle",
    dirty: false,
    savedAt: null,
    error: null,
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
        const draft = captureCheckpoint(state);
        const urls = referencedMedia(draft);
        const database = await getDatabase();
        knownAssetIds ??= await listProjectMediaIds(database);
        const newMedia = new Map<string, Blob>();
        await Promise.all(
          urls.map(async (url) => {
            let assetId = assetIdByUrl.get(url);
            if (!assetId) {
              assetId = newAssetId();
              assetIdByUrl.set(url, assetId);
            }
            if (!knownAssetIds!.has(assetId))
              newMedia.set(assetId, await blobFor(url));
          }),
        );
        // A new edit or reset during the asynchronous Blob read supersedes this draft.
        if (target !== revision) continue;
        const savedAt = Date.now();
        const record = storeCheckpoint(draft, assetIdByUrl, savedAt);
        if (target !== revision) continue;
        await writeProjectCheckpoint(database, record, newMedia, isProjectDiscarded());
        savedRevision = target;
        knownAssetIds = await listProjectMediaIds(database);
        const wanted = new Set(urls);
        for (const cachedUrl of assetIdByUrl.keys())
          if (!wanted.has(cachedUrl)) assetIdByUrl.delete(cachedUrl);
        mediaCache.clear();
        if (target === revision) clearProjectDiscarded();
        publish({
          phase: "saved",
          dirty: target !== revision,
          savedAt,
          error: null,
        });
      } catch (error) {
        if (target !== revision) continue;
        const failure = contextualError("save", error);
        publish({
          ...status,
          phase: "error",
          dirty: true,
          error: failure.message,
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
    const next = markers(state);
    if (!shouldQueue(next, lastMarkers, state)) return;
    lastMarkers = next;
    revision += 1;
    publish({ ...status, dirty: true, error: null });
    cancelTimer();
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
      if (isProjectDiscarded()) return null;
      const database = await getDatabase();
      const record = await readProjectCheckpoint(database, requestedId);
      if (!record && requestedId)
        throw new Error("This project isn't saved in this browser.");
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
      publish({ ...status, phase: "error", error: failure.message });
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
      await discardProjectCheckpoint(database, requestedId);
      restorePromise = Promise.resolve(null);
      knownAssetIds = null;
      mediaCache.clear();
      assetIdByUrl.clear();
      publish({ phase: "idle", dirty: false, savedAt: null, error: null });
    } catch (error) {
      const failure = contextualError("discard", error);
      publish({ ...status, phase: "error", error: failure.message });
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
