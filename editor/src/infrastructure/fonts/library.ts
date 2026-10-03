import { validateFontAsset, type AppliedFont } from "../../../../packages/pvo-fonts/index.js";

const DATABASE = "restyle-font-library";
const STORE = "fonts";

async function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(new Error("Couldn't open saved fonts in this browser."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close other editor tabs and try saving again."));
    };
  });
}

export async function readSavedFonts(): Promise<AppliedFont[]> {
  const database = await openLibrary();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      transaction.oncomplete = () => {
        try { resolve(request.result.map(validateFontAsset)); }
        catch { reject(new Error("A saved font could not be read.")); }
      };
      transaction.onerror = () => reject(new Error("Couldn't read saved fonts."));
      transaction.onabort = () => reject(new Error("Reading saved fonts was interrupted."));
    });
  } finally { database.close(); }
}

export async function writeSavedFont(input: AppliedFont): Promise<void> {
  const font = validateFontAsset(input);
  const database = await openLibrary();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const count = store.count();
      const existing = store.get(font.id);
      existing.onsuccess = () => {
        if (!existing.result && count.result >= 40) { transaction.abort(); return; }
        store.put(font);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error(transaction.error?.name === "QuotaExceededError"
        ? "Browser storage is full. Free some space and retry."
        : "Couldn't save this font. The library holds 40 fonts."));
      transaction.onerror = () => reject(new Error("Couldn't save this font in browser storage."));
    });
  } finally { database.close(); }
}
