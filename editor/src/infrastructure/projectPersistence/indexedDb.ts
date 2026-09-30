import type { StoredCheckpoint } from "./checkpoint";

const DB_NAME = "restyle-editor-project";
const CHECKPOINT_STORE = "checkpoints";
const MEDIA_STORE = "media";
const CURRENT_KEY = "current";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Browser storage transaction was cancelled."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Browser storage transaction failed."));
  });
}

export function openProjectDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(new Error("Browser storage is not available."));
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHECKPOINT_STORE))
        database.createObjectStore(CHECKPOINT_STORE);
      if (!database.objectStoreNames.contains(MEDIA_STORE))
        database.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Browser storage is blocked by another open tab."));
    };
  });
}

export async function readProjectCheckpoint(database: IDBDatabase, id?: string): Promise<StoredCheckpoint | undefined> {
  const transaction = database.transaction(CHECKPOINT_STORE, "readonly");
  const complete = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(CHECKPOINT_STORE).get(id ? `project:${id}` : CURRENT_KEY));
  await complete;
  return result as StoredCheckpoint | undefined;
}

export async function readProjectMedia(database: IDBDatabase, ids: string[]): Promise<Map<string, Blob>> {
  const transaction = database.transaction(MEDIA_STORE, "readonly");
  const complete = transactionDone(transaction);
  const store = transaction.objectStore(MEDIA_STORE);
  const values = await Promise.all(ids.map(async id => {
    const blob = await requestResult(store.get(id));
    if (!(blob instanceof Blob))
      throw new Error(`Saved video asset ${id} is missing.`);
    return [id, blob] as const;
  }));
  await complete;
  return new Map(values);
}

export async function listProjectMediaIds(database: IDBDatabase): Promise<Set<string>> {
  const transaction = database.transaction(MEDIA_STORE, "readonly");
  const complete = transactionDone(transaction);
  const keys = await requestResult(transaction.objectStore(MEDIA_STORE).getAllKeys());
  await complete;
  return new Set(keys.filter((key): key is string => typeof key === "string"));
}

/** Removes one saved edit and media that no remaining checkpoint references. */
export async function discardProjectCheckpoint(database: IDBDatabase, id?: string): Promise<void> {
  const transaction = database.transaction([CHECKPOINT_STORE, MEDIA_STORE], "readwrite");
  const complete = transactionDone(transaction);
  const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
  const media = transaction.objectStore(MEDIA_STORE);
  const checkpointKeys = checkpoints.getAllKeys();
  const records = checkpoints.getAll();
  const mediaKeys = media.getAllKeys();
  let completedReads = 0;
  let failure: Error | null = null;

  const discard = () => {
    completedReads += 1;
    if (completedReads !== 3) return;
    try {
      const keys = checkpointKeys.result;
      const saved = records.result as StoredCheckpoint[];
      const targetKey = id ? `project:${id}` : CURRENT_KEY;
      const targetIndex = keys.findIndex(key => key === targetKey);
      const target = targetIndex >= 0 ? saved[targetIndex] : undefined;
      const discardedKeys = new Set<IDBValidKey>([targetKey]);

      if (!id && typeof target?.localId === "string")
        discardedKeys.add(`project:${target.localId}`);
      if (id) {
        const currentIndex = keys.findIndex(key => key === CURRENT_KEY);
        if (currentIndex >= 0 && saved[currentIndex]?.localId === id)
          discardedKeys.add(CURRENT_KEY);
      }

      const retainedAssets = new Set<string>();
      let canCollectMedia = true;
      saved.forEach((record, index) => {
        if (discardedKeys.has(keys[index])) return;
        if (!Array.isArray(record?.assetIds) || record.assetIds.some(assetId => typeof assetId !== "string")) {
          canCollectMedia = false;
          return;
        }
        record.assetIds.forEach(assetId => retainedAssets.add(assetId));
      });
      discardedKeys.forEach(key => checkpoints.delete(key));
      if (canCollectMedia)
        mediaKeys.result.forEach(key => {
          if (typeof key === "string" && !retainedAssets.has(key)) media.delete(key);
        });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      transaction.abort();
    }
  };

  checkpointKeys.onsuccess = discard;
  records.onsuccess = discard;
  mediaKeys.onsuccess = discard;
  try {
    await complete;
  } catch (error) {
    throw failure ?? error;
  }
}

export async function writeProjectCheckpoint(
  database: IDBDatabase,
  record: StoredCheckpoint,
  newMedia: Map<string, Blob>,
  discardPrevious = false,
): Promise<void> {
  // Asset changes and the referencing snapshot share one transaction. Removing
  // unreachable old assets first releases quota, while rollback protects them
  // if any new video or the checkpoint fails to write.
  const transaction = database.transaction([CHECKPOINT_STORE, MEDIA_STORE], "readwrite");
  const complete = transactionDone(transaction);
  const mediaStore = transaction.objectStore(MEDIA_STORE);
  const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
  const savedProjects = checkpoints.getAll();
  const previousCurrent = checkpoints.get(CURRENT_KEY);
  const keys = mediaStore.getAllKeys();
  let failure: Error | null = null;
  keys.onsuccess = () => {
    try {
      const existing = new Set(keys.result.filter((key): key is string => typeof key === "string"));
      const wanted = new Set(record.assetIds);
      // An anonymous checkpoint may be new camera work. Only an explicit session
      // reset is allowed to remove the previously current named project.
      const discardedId = discardPrevious && !record.localId
        ? (previousCurrent.result as StoredCheckpoint | undefined)?.localId
        : undefined;
      // Keep media referenced by other local projects, including their undo history.
      let canCollectMedia = true;
      for (const saved of savedProjects.result as StoredCheckpoint[]) {
        if (!saved.localId || saved.localId === record.localId || saved.localId === discardedId) continue;
        if (!Array.isArray(saved.assetIds) || saved.assetIds.some(id => typeof id !== "string")) {
          canCollectMedia = false;
          continue;
        }
        saved.assetIds.forEach(id => wanted.add(id));
      }
      for (const id of wanted)
        if (!existing.has(id) && !newMedia.has(id))
          throw new Error(`Video asset ${id} was not available for saving.`);
      for (const id of existing)
        if (canCollectMedia && !wanted.has(id))
          mediaStore.delete(id);
      for (const [id, blob] of newMedia)
        if (wanted.has(id) && !existing.has(id))
          mediaStore.put(blob, id);
      checkpoints.put(record, CURRENT_KEY);
      if (discardedId) checkpoints.delete(`project:${discardedId}`);
      if (record.localId) checkpoints.put(record, `project:${record.localId}`);
    } catch (error) {
      transaction.abort();
      failure = error instanceof Error ? error : new Error(String(error));
    }
  };
  try {
    await complete;
  } catch (error) {
    throw failure ?? error;
  }
}
