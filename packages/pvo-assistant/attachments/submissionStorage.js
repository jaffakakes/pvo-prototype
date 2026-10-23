import { text } from "../tasks/validation.js";
import { parseServiceSubmission } from "./submissions.js";

const DATABASE = "restyle-service-submissions";
const STORE = "submissions";

/** Browser adapter. The caller owns this connection and must close it when its session is disposed. */
export function openServiceSubmissionStore(factory = globalThis.indexedDB) {
  if (!factory)
    return Promise.reject(
      new Error("Browser submission storage is unavailable."),
    );
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open saved submissions."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Saved submissions are blocked by another tab."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      function access(slot, change) {
        return new Promise((resolve, reject) => {
          text(slot, 2048, "Submission storage key");
          const transaction = database.transaction(
            STORE,
            change ? "readwrite" : "readonly",
          );
          const store = transaction.objectStore(STORE);
          let result, failure;
          transaction.oncomplete = () => resolve(result);
          transaction.onabort = () =>
            reject(
              failure ??
                transaction.error ??
                new Error("Saving the submission was cancelled."),
            );
          transaction.onerror = () => {
            failure ??= transaction.error;
          };
          const read = store.get(slot);
          read.onsuccess = () => {
            try {
              const current =
                read.result === undefined
                  ? null
                  : parseServiceSubmission(read.result);
              result = change
                ? parseServiceSubmission(change(current))
                : current;
              if (change) store.put(result, slot);
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          };
        });
      }
      resolve({
        read: (slot) => access(slot),
        update: (slot, change) => access(slot, change),
        close: () => database.close(),
      });
    };
  });
}
