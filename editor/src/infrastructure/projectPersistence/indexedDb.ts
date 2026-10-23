import {
  assertCheckpointVersion,
  checkpointVersion,
  type CheckpointVersion,
} from "./checkpointVersion";
import type { StoredCheckpoint } from "./checkpoint";

const DB_NAME = "restyle-editor-project";
const CHECKPOINT_STORE = "checkpoints";
const MEDIA_STORE = "media";
const CURRENT_KEY = "current";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("Browser storage transaction was cancelled."),
      );
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Browser storage transaction failed."),
      );
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
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open browser storage."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Browser storage is blocked by another open tab."));
    };
  });
}

export async function readProjectCheckpoint(
  database: IDBDatabase,
  id?: string,
): Promise<StoredCheckpoint | undefined> {
  const transaction = database.transaction(CHECKPOINT_STORE, "readonly");
  const complete = transactionDone(transaction);
  const result = await requestResult(
    transaction
      .objectStore(CHECKPOINT_STORE)
      .get(id ? `project:${id}` : CURRENT_KEY),
  );
  await complete;
  return result as StoredCheckpoint | undefined;
}

export async function readProjectMedia(
  database: IDBDatabase,
  ids: string[],
): Promise<Map<string, Blob>> {
  const transaction = database.transaction(MEDIA_STORE, "readonly");
  const complete = transactionDone(transaction);
  const store = transaction.objectStore(MEDIA_STORE);
  const values = await Promise.all(
    ids.map(async (id) => {
      const blob = await requestResult(store.get(id));
      if (!(blob instanceof Blob))
        throw new Error(`Saved video asset ${id} is missing.`);
      return [id, blob] as const;
    }),
  );
  await complete;
  return new Map(values);
}

export async function listProjectMediaIds(
  database: IDBDatabase,
): Promise<Set<string>> {
  const transaction = database.transaction(MEDIA_STORE, "readonly");
  const complete = transactionDone(transaction);
  const keys = await requestResult(
    transaction.objectStore(MEDIA_STORE).getAllKeys(),
  );
  await complete;
  return new Set(keys.filter((key): key is string => typeof key === "string"));
}

function checkpointKey(id: string | null) {
  return id ? "project:" + id : CURRENT_KEY;
}

/** Keep every remaining checkpoint's media, including anonymous drafts. */
function retainMedia(
  keys: IDBValidKey[],
  records: StoredCheckpoint[],
  removed: Set<IDBValidKey>,
  wanted: Set<string>,
): boolean {
  let canCollect = true;
  records.forEach((record, index) => {
    if (removed.has(keys[index])) return;
    if (
      !Array.isArray(record?.assetIds) ||
      record.assetIds.some((id) => typeof id !== "string")
    ) {
      canCollect = false;
      return;
    }
    record.assetIds.forEach((id) => wanted.add(id));
  });
  return canCollect;
}

/** Discard only the exact checkpoint the caller observed. */
export async function discardProjectCheckpoint(
  database: IDBDatabase,
  id: string | null,
  expected: CheckpointVersion,
): Promise<void> {
  const transaction = database.transaction(
    [CHECKPOINT_STORE, MEDIA_STORE],
    "readwrite",
  );
  const complete = transactionDone(transaction);
  const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
  const media = transaction.objectStore(MEDIA_STORE);
  const checkpointKeys = checkpoints.getAllKeys();
  const records = checkpoints.getAll();
  const mediaKeys = media.getAllKeys();
  let completedReads = 0;
  let failure: unknown;
  const discard = () => {
    if (++completedReads !== 3) return;
    try {
      const keys = checkpointKeys.result;
      const saved = records.result as StoredCheckpoint[];
      const targetKey = checkpointKey(id);
      const target = saved[keys.findIndex((key) => key === targetKey)];
      assertCheckpointVersion(target, expected);
      const removed = new Set<IDBValidKey>([targetKey]);
      const alias = id
        ? CURRENT_KEY
        : typeof target?.localId === "string"
          ? checkpointKey(target.localId)
          : null;
      if (
        alias &&
        checkpointVersion(saved[keys.findIndex((key) => key === alias)]) ===
          expected
      )
        removed.add(alias);
      const wanted = new Set<string>();
      const canCollect = retainMedia(keys, saved, removed, wanted);
      removed.forEach((key) => checkpoints.delete(key));
      if (canCollect)
        mediaKeys.result.forEach((key) => {
          if (typeof key === "string" && !wanted.has(key)) media.delete(key);
        });
    } catch (error) {
      failure = error;
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

export type CheckpointWriteGuard = {
  expectedVersion: CheckpointVersion;
  currentVersion: CheckpointVersion;
};

/** Compare and write atomically, before touching any checkpoint or Blob. */
export async function writeProjectCheckpoint(
  database: IDBDatabase,
  record: StoredCheckpoint,
  newMedia: Map<string, Blob>,
  guard: CheckpointWriteGuard,
): Promise<void> {
  const transaction = database.transaction(
    [CHECKPOINT_STORE, MEDIA_STORE],
    "readwrite",
  );
  const complete = transactionDone(transaction);
  const checkpoints = transaction.objectStore(CHECKPOINT_STORE);
  const media = transaction.objectStore(MEDIA_STORE);
  const checkpointKeys = checkpoints.getAllKeys();
  const records = checkpoints.getAll();
  const mediaKeys = media.getAllKeys();
  let completedReads = 0;
  let failure: unknown;
  const write = () => {
    if (++completedReads !== 3) return;
    try {
      const keys = checkpointKeys.result;
      const saved = records.result as StoredCheckpoint[];
      const targetKey = checkpointKey(record.localId ?? null);
      assertCheckpointVersion(
        saved[keys.findIndex((key) => key === targetKey)],
        guard.expectedVersion,
      );
      const current = saved[keys.findIndex((key) => key === CURRENT_KEY)];
      // Autosaving A must not take over another tab's current project B.
      const writeCurrent = checkpointVersion(current) === guard.currentVersion;
      const replaced = new Set<IDBValidKey>([targetKey]);
      if (writeCurrent) replaced.add(CURRENT_KEY);
      const wanted = new Set(record.assetIds);
      const canCollect = retainMedia(keys, saved, replaced, wanted);
      const existing = new Set(
        mediaKeys.result.filter(
          (key): key is string => typeof key === "string",
        ),
      );
      for (const id of wanted)
        if (!existing.has(id) && !newMedia.has(id))
          throw new Error(
            "Video asset " + id + " was not available for saving.",
          );
      if (canCollect)
        existing.forEach((id) => {
          if (!wanted.has(id)) media.delete(id);
        });
      for (const [id, blob] of newMedia)
        if (wanted.has(id) && !existing.has(id)) media.put(blob, id);
      checkpoints.put(record, targetKey);
      if (writeCurrent && targetKey !== CURRENT_KEY)
        checkpoints.put(record, CURRENT_KEY);
    } catch (error) {
      failure = error;
      transaction.abort();
    }
  };
  checkpointKeys.onsuccess = write;
  records.onsuccess = write;
  mediaKeys.onsuccess = write;
  try {
    await complete;
  } catch (error) {
    throw failure ?? error;
  }
}
