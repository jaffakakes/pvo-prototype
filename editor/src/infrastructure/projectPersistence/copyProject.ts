import { copyProjectCheckpoint, type StoredCheckpoint } from "./checkpoint";
import { openProjectDatabase } from "./indexedDb";

/** Atomically copy a saved checkpoint. Shared Blob IDs stay local; no media is uploaded. */
export async function copySavedProject(
  sourceId: string,
  copyId: string,
  name: string,
): Promise<void> {
  const database = await openProjectDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("checkpoints", "readwrite");
      const store = transaction.objectStore("checkpoints");
      const source = store.get(`project:${sourceId}`);
      const destination = store.get(`project:${copyId}`);
      let failure: unknown;
      destination.onsuccess = () => {
        try {
          if (!source.result)
            throw new Error(
              "The original project is not saved in this browser.",
            );
          if (destination.result)
            throw new Error("A project with this identity already exists.");
          const copy = copyProjectCheckpoint(
            source.result as StoredCheckpoint,
            copyId,
            name,
            Date.now(),
          );
          store.put(copy, `project:${copyId}`);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(
          failure ??
            transaction.error ??
            new Error("Could not copy the saved project."),
        );
    });
  } finally {
    database.close();
  }
}
